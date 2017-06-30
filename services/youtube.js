/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const debug = require('debug')('app:youtube');
const base = require('../base');
const CustomError = require('../customError').CustomError;
var apiQuote = new base.Quote(1000);
const requestPromise = apiQuote.wrapper(require('request-promise'));

var Youtube = function(options) {
    var _this = this;
    this.gOptions = options;
    this.config = {};
    this.config.token = options.config.ytToken;
    this.channels = options.channels;
    this.name = 'youtube';
};

Youtube.prototype.getChannelUrl = function (channelId) {
    return 'https://youtube.com/channel/' + channelId;
};

Youtube.prototype.getFullCheckTime = function (factor) {
    if (!factor) {
        factor = 1;
    }
    return new Date((parseInt(Date.now() / 1000) - factor * 3 * 24 * 60 * 60) * 1000).toISOString();
};

Youtube.prototype.clean = function () {
    var _this = this;
    var db = _this.gOptions.db;
    var promise = Promise.resolve();
    promise = promise.then(function () {
        return _this.channels.removeUnusedChannels();
    });
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
                DELETE FROM messages WHERE publishedAt < ?; \
            ', [_this.getFullCheckTime(2)], function (err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
    return promise;
};

/**
 * @param {String} id
 * @return {Promise}
 */
Youtube.prototype.videoIdInList = function(id) {
    const _this = this;
    const db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT id FROM messages WHERE id = ? LIMIT 1; \
        ', [id], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(!!results.length);
            }
        });
    });
};

// from momentjs
const isoRegex = /^PT(?:(-?[0-9,.]*)H)?(?:(-?[0-9,.]*)M)?(?:(-?[0-9,.]*)S)?$/;
const parseIso = function (inp) {
    var res = inp && parseFloat(inp.replace(',', '.'));
    return (isNaN(res) ? 0 : res);
};
const formatDuration = function (str) {
    var result = '';
    var match = isoRegex.exec(str);
    if (!match) {
        debug('formatDuration error', str);
    } else {
        var parts = [
            parseIso(match[1]),
            parseIso(match[2]),
            parseIso(match[3])
        ];
        if (parts[0] === 0) {
            parts.shift();
        }
        result = parts.map(function (count, index) {
            if (index > 0 && count < 10) {
                count = '0' + count;
            }
            return count;
        }).join(':');
    }
    return result;
};

/**
 * @typedef {{}} VideoSnippet
 * @property {String} publishedAt // 2017-02-18T01:00:00.000Z
 * @property {String} channelId
 * @property {String} title
 * @property {String} description
 * @property {{}} thumbnails
 * @property {{}} thumbnails.default
 * @property {String} thumbnails.default.url
 * @property {String} thumbnails.default.width
 * @property {String} thumbnails.default.height
 * @property {{}} thumbnails.medium
 * @property {String} thumbnails.medium.url
 * @property {String} thumbnails.medium.width
 * @property {String} thumbnails.medium.height
 * @property {{}} thumbnails.high
 * @property {String} thumbnails.high.url
 * @property {String} thumbnails.high.width
 * @property {String} thumbnails.high.height
 * @property {{}} thumbnails.standard
 * @property {String} thumbnails.standard.url
 * @property {String} thumbnails.standard.width
 * @property {String} thumbnails.standard.height
 * @property {{}} thumbnails.maxres
 * @property {String} thumbnails.maxres.url
 * @property {String} thumbnails.maxres.width
 * @property {String} thumbnails.maxres.height
 * @property {String} channelTitle
 * @property {String} type
 * @property {String} groupId
 */

/**
 * @typedef {{}} VideoDetails
 * @property {string} duration
 * @property {string} dimension
 * @property {string} definition
 * @property {string} caption
 * @property {string} licensedContent
 * @property {string} projection
 */

/**
 * @param {dbChannel} channel
 * @param {String[]} chatIdList
 * @param {string} id
 * @param {VideoSnippet} snippet
 * @param {VideoDetails} contentDetails
 * @returns {Promise}
 */
Youtube.prototype.insertItem = function (channel, chatIdList, id, snippet, contentDetails) {
    var _this = this;
    var db = this.gOptions.db;

    var previewList = Object.keys(snippet.thumbnails).map(function(quality) {
        return snippet.thumbnails[quality];
    }).sort(function(a, b) {
        return a.width > b.width ? -1 : 1;
    }).map(function(item) {
        return item.url;
    });

    var data = {
        url: 'https://youtu.be/' + id,
        title: snippet.title,
        preview: previewList,
        duration: formatDuration(contentDetails.duration),
        channel: {
            title: snippet.channelTitle,
            id: channel.id
        }
    };

    var item = {
        id: _this.channels.wrapId(id, _this.name),
        channelId: channel.id,
        publishedAt: snippet.publishedAt,
        data: JSON.stringify(data)
    };

    var insert = function (item) {
        return db.transaction(function (connection) {
            return new Promise(function (resolve, reject) {
                connection.query('INSERT INTO messages SET ?', item, function (err, results) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(item.id);
                    }
                });
            }).then(function (messageId) {
                return _this.gOptions.msgStack.addChatIdsMessageId(connection, chatIdList, messageId);
            });
        });
    };
    return insert(item).then(function () {
        return item;
    }).catch(function (err) {
        if (err.code !== 'ER_DUP_ENTRY') {
            debug('insertItem', err);
        }
    });
};

var requestPool = new base.Pool(10);
var insertPool = new base.Pool(15);

/**
 * @param {dbChannel[]} _channelList
 * @param {boolean} [isFullCheck]
 * @return {Promise}
 */
Youtube.prototype.getVideoList = function(_channelList, isFullCheck) {
    var _this = this;
    var updatedChannels = [];

    var getVideoIdsInfo = function (channel, ytVideoIds, chatIdList) {
        var lastPublishedAt = '';
        var channelTitle = '';

        var pageLimit = 100;
        /**
         * @param {String} [pageToken]
         * @return {Promise}
         */
        var getPage = function (pageToken) {
            var retryLimit = 5;
            var requestPage = function () {
                return requestPromise({
                    method: 'GET',
                    url: 'https://www.googleapis.com/youtube/v3/videos',
                    qs: {
                        part: 'snippet,contentDetails',
                        id: ytVideoIds.join(','),
                        pageToken: pageToken,
                        fields: 'items/id,items/snippet,items/contentDetails,nextPageToken',
                        key: _this.config.token
                    },
                    json: true,
                    gzip: true,
                    forever: true
                }).catch(function (err) {
                    if (retryLimit-- < 1) {
                        throw err;
                    }

                    return new Promise(function (resolve) {
                        setTimeout(resolve, 250);
                    }).then(function () {
                        return requestPage();
                    });
                });
            };

            /**
             * @typedef {{}} v3Videos
             * @property {string} nextPageToken
             * @property {[{id: string,snippet:VideoSnippet,contentDetails:{}}]} items
             */

            return requestPage().then(function (/*v3Videos*/responseBody) {
                var items = responseBody.items;
                return insertPool.do(function () {
                    var item = items.shift();
                    if (!item) return;

                    var id = item.id;
                    var snippet = item.snippet;
                    var contentDetails = item.contentDetails;
                    if (lastPublishedAt < snippet.publishedAt) {
                        lastPublishedAt = snippet.publishedAt;
                    }
                    if (channelTitle !== snippet.channelTitle) {
                        channelTitle = snippet.channelTitle;
                    }

                    return _this.insertItem(channel, chatIdList, id, snippet, contentDetails).then(function (item) {
                        if (isFullCheck && item && updatedChannels.indexOf(channel) === -1) {
                            updatedChannels.push(channel);
                        }
                    });
                }).then(function () {
                    if (responseBody.nextPageToken) {
                        if (pageLimit-- < 1) {
                            throw new CustomError('Page limit reached ' + channel.id);
                        }

                        return getPage(responseBody.nextPageToken);
                    }
                });
            });
        };

        return getPage().then(function () {
            let isChange = false;
            if (lastPublishedAt) {
                channel.publishedAfter = lastPublishedAt;
                isChange = true;
            }
            if (channelTitle && channel.title !== channelTitle) {
                channel.title = channelTitle;
                isChange = true;
            }
            if (isChange) {
                return _this.channels.updateChannel(channel.id, channel);
            }
        }).catch(function(err) {
            debug('getVideos error! %s', channel.id, err);
        });
    };

    var requestNewVideoIds = function (/*dbChannel*/channel) {
        var newVideoIds = [];

        var channelId = channel.id;
        var publishedAfter = channel.publishedAfter;
        if (isFullCheck || !publishedAfter) {
            publishedAfter = _this.getFullCheckTime();
        } else {
            publishedAfter = (new Date(new Date(publishedAfter).getTime() + 1000)).toISOString();
        }

        var pageLimit = 100;
        /**
         * @param {String} [pageToken]
         * @return {Promise}
         */
        var getPage = function (pageToken) {
            var retryLimit = 5;
            var requestPage = function () {
                return requestPromise({
                    method: 'GET',
                    url: 'https://www.googleapis.com/youtube/v3/activities',
                    qs: {
                        part: 'contentDetails',
                        channelId: _this.channels.unWrapId(channelId),
                        maxResults: 50,
                        pageToken: pageToken,
                        fields: 'items/contentDetails/upload/videoId,nextPageToken',
                        publishedAfter: publishedAfter,
                        key: _this.config.token
                    },
                    json: true,
                    gzip: true,
                    forever: true
                }).catch(function (err) {
                    if (retryLimit-- < 1) {
                        throw err;
                    }

                    return new Promise(function (resolve) {
                        setTimeout(resolve, 250);
                    }).then(function () {
                        return requestPage();
                    });
                });
            };

            /**
             * @typedef {{}} v3Activities
             * @property {string} nextPageToken
             * @property {[{contentDetails:{upload:{videoId:string}}}]} items
             */

            return requestPage().then(function (/*v3Activities*/responseBody) {
                var items = responseBody.items;
                var idVideoIdMap = {};
                var ids = [];
                items.forEach(function (item) {
                    var ytVideoId = item.contentDetails.upload.videoId;
                    var videoId = _this.channels.wrapId(ytVideoId, _this.name);
                    if (ids.indexOf(videoId) === -1) {
                        ids.push(videoId);
                        idVideoIdMap[videoId] = ytVideoId;
                    }
                });
                return _this.gOptions.msgStack.messageIdsExists(ids).then(function (exIds) {
                    ids.forEach(function (id) {
                        if (exIds.indexOf(id) === -1) {
                            newVideoIds.unshift(idVideoIdMap[id]);
                        }
                    });
                }).then(function () {
                    if (responseBody.nextPageToken) {
                        if (pageLimit-- < 1) {
                            throw new CustomError('Page limit reached ' + channelId);
                        }

                        return getPage(responseBody.nextPageToken);
                    }
                });
            });
        };

        return getPage().catch(function(err) {
            debug('requestPages error! %s', channelId, err);
        }).then(function () {
            return newVideoIds;
        });
    };

    var promise = Promise.resolve();
    if (isFullCheck) {
        promise = promise.then(function () {
            return _this.clean();
        });
    }
    promise = promise.then(function () {
        return _channelList;
    });
    promise = promise.then(function (channels) {
        return requestPool.do(function () {
            /**
             * @type {dbChannel}
             */
            var channel = channels.shift();
            if (!channel) return;

            return _this.gOptions.users.getChatIdsByChannel(channel.id).then(function (chatIdList) {
                if (!chatIdList.length) return;

                return requestNewVideoIds(channel).then(function (ytVideoIds) {
                    var queue = Promise.resolve();
                    base.arrToParts(ytVideoIds, 50).forEach(function (partYtVideoIds) {
                        queue = queue.then(function () {
                            return getVideoIdsInfo(channel, partYtVideoIds, chatIdList);
                        });
                    });
                    return queue;
                });
            });
        });
    });

    promise = promise.then(function () {
        updatedChannels.forEach(function (channel) {
            _this.gOptions.events.emit('subscribe', channel);
        });
    });

    return promise;
};

/**
 * @param {dbChannel} channel
 * @return {Promise.<dbChannel>}
 */
Youtube.prototype.channelExists = function (channel) {
    var _this = this;
    const channelId = _this.channels.unWrapId(channel.id);
    return _this.getChannelId(channelId);
};

/**
 * @param {String} rawQuery
 * @return {Promise.<string>}
 */
Youtube.prototype.requestChannelIdByQuery = function(rawQuery) {
    var _this = this;

    var query = '';
    [
        /youtube\.com\/(?:#\/)?c\/([\w\-]+)/i
    ].some(function (re) {
        var m = re.exec(rawQuery);
        if (m) {
            query = m[1];
            return true;
        }
    });

    if (!query) {
        query = rawQuery;
    }

    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/search',
        qs: {
            part: 'snippet',
            q: query,
            type: 'channel',
            maxResults: 1,
            fields: 'items(id)',
            key: _this.config.token
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(responseBody) {
        var channelId = '';
        responseBody.items.some(function (item) {
            return channelId = item.id.channelId;
        });
        if (!channelId) {
            throw new CustomError('Channel ID is not found by query!');
        }

        return channelId;
    });
};

/**
 * @param {String} url
 * @return {Promise.<String>}
 */
Youtube.prototype.requestChannelIdByUsername = function(url) {
    var _this = this;

    var username = '';
    [
        /youtube\.com\/(?:#\/)?user\/([\w\-]+)/i,
        /youtube\.com\/([\w\-]+)/i
    ].some(function (re) {
        var m = re.exec(url);
        if (m) {
            username = m[1];
            return true;
        }
    });

    if (!username) {
        username = url;
    }

    if (!/^[\w\-]+$/.test(username)) {
        return Promise.reject(new CustomError('It is not username!'));
    }

    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/channels',
        qs: {
            part: 'snippet',
            forUsername: username,
            maxResults: 1,
            fields: 'items/id',
            key: _this.config.token
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(responseBody) {
        var id = '';
        responseBody.items.some(function (item) {
            return id = item.id;
        });
        if (!id) {
            throw new CustomError('Channel ID is not found by username!');
        }

        return id;
    });
};

/**
 * @param {String} url
 * @returns {Promise.<String>}
 */
Youtube.prototype.getChannelIdByUrl = function (url) {
    var channelId = '';
    [
        /youtube\.com\/(?:#\/)?channel\/([\w\-]+)/i
    ].some(function (re) {
        var m = re.exec(url);
        if (m) {
            channelId = m[1];
            return true;
        }
    });

    if (!channelId) {
        channelId = url;
    }

    if (!/^UC/.test(channelId)) {
        return Promise.reject(new CustomError('It is not channel url!'));
    }

    return Promise.resolve(channelId);
};

/**
 * @param {String} url
 * @return {Promise.<string>}
 */
Youtube.prototype.requestChannelIdByVideoUrl = function (url) {
    var _this = this;

    var videoId = '';
    [
        /youtu\.be\/([\w\-]+)/i,
        /youtube\.com\/.+[?&]v=([\w\-]+)/i,
        /youtube\.com\/(?:.+\/)?(?:v|embed)\/([\w\-]+)/i
    ].some(function (re) {
        var m = re.exec(url);
        if (m) {
            videoId = m[1];
            return true;
        }
    });

    if (!videoId) {
        return Promise.reject(new CustomError('It is not video url!'));
    }

    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/videos',
        qs: {
            part: 'snippet',
            id: videoId,
            maxResults: 1,
            fields: 'items/snippet',
            key: _this.config.token
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(responseBody) {
        var channelId = '';
        responseBody.items.some(function (item) {
            return channelId = item.snippet.channelId;
        });
        if (!channelId) {
            throw new CustomError('Channel ID is empty');
        }

        return channelId;
    });
};

/**
 /add https://www.youtube.com/user/ThePrimeThanatos
 /add ThePrimeThanatos
 /add Premium Extensions HQ
 /add https://www.youtube.com/watch?v=SF58Lsvqg5E
 /add https://www.youtube.com/channel/UCmYTgpKxd-QOJCPDrmaXuqQ
 /add https://www.youtube.com/c/UCmYTgpKxd-QOJCPDrmaXuqQ
 /add UCmYTgpKxd-QOJCPDrmaXuqQ
 /add https://www.youtube.com/user/ChromeDevelopers/videos
 /add https://www.youtube.com/ChromeDevelopers
 */

/**
 * @param {String} channelName
 * @return {Promise.<dbChannel>}
 */
Youtube.prototype.getChannelId = function(channelName) {
    var _this = this;

    return _this.getChannelIdByUrl(channelName).catch(function (err) {
        if (!(err instanceof CustomError)) {
            throw err;
        }

        return _this.requestChannelIdByVideoUrl(channelName).catch(function (err) {
            if (!(err instanceof CustomError)) {
                throw err;
            }

            return _this.requestChannelIdByUsername(channelName).catch(function (err) {
                if (!(err instanceof CustomError)) {
                    throw err;
                }

                return _this.requestChannelIdByQuery(channelName);
            });
        });
    }).then(function(channelId) {
        return requestPromise({
            method: 'GET',
            url: 'https://www.googleapis.com/youtube/v3/search',
            qs: {
                part: 'snippet',
                channelId: channelId,
                maxResults: 1,
                fields: 'items/snippet',
                key: _this.config.token
            },
            json: true,
            gzip: true,
            forever: true
        }).then(function(responseBody) {
            var snippet = null;
            responseBody.items.some(function (item) {
                return snippet = item.snippet;
            });
            if (!snippet) {
                throw new CustomError('Channel is not found');
            }

            const title = snippet.channelTitle;
            const url = _this.getChannelUrl(channelId);

            return _this.channels.insertChannel(channelId, _this.name, title, url).then(function (channel) {
                return _this.channels.getChannels([channel.id]).then(function (channels) {
                    return channels[0];
                });
            });
        });
    });
};

module.exports = Youtube;