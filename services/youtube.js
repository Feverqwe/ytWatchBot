/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
var debug = require('debug')('app:youtube');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);
var CustomError = require('../customError').CustomError;

var apiQuote = new base.Quote(1000);
requestPromise = apiQuote.wrapper(requestPromise.bind(requestPromise));

var Youtube = function(options) {
    var _this = this;
    this.gOptions = options;
    this.config = {};
    this.config.token = options.config.ytToken;

    this.onReady = this.init();
};

Youtube.prototype.init = function () {
    var _this = this;
    var db = this.gOptions.db;
    var promise = Promise.resolve();
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
            CREATE TABLE IF NOT EXISTS `ytChannels` ( \
                `id` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `title` TEXT CHARACTER SET utf8mb4 NOT NULL, \
                `localTitle` TEXT CHARACTER SET utf8mb4 NULL, \
                `username` TEXT CHARACTER SET utf8mb4 NULL, \
                `publishedAfter` TEXT CHARACTER SET utf8mb4 NULL, \
            UNIQUE INDEX `id_UNIQUE` (`id` ASC)); \
        ', function (err) {
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

var videoIdToId = function (videoId) {
    return 'y_' + videoId;
};

/**
 * @typedef {{}} ChannelInfo
 * @property {String} id
 * @property {String} title
 * @property {String} [localTitle]
 * @property {String} [username]
 * @property {String} publishedAfter
 */

/**
 * @private
 * @param {String} channelId
 * @return {{}}
 */
Youtube.prototype.getChannelInfo = function (channelId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT * FROM ytChannels WHERE id = ? LIMIT 1; \
        ', [channelId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results[0] || {});
            }
        });
    }).catch(function (err) {
        debug('getChannelInfo', err);
        return {};
    });
};

/**
 * @param {Object} info
 * @return {Promise}
 */
Youtube.prototype.setChannelInfo = function(info) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            INSERT INTO ytChannels SET ? ON DUPLICATE KEY UPDATE ? \
        ', [info, info], function (err, results) {
            if (err) {
                debug('setChannelInfo', err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

Youtube.prototype.setChannelPublishedAfter = function (channelId, publishedAfter) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            UPDATE ytChannels SET publishedAfter = ? WHERE id = ? \
        ', [publishedAfter, channelId], function (err, results) {
            if (err) {
                debug('setChannelPublishedAfter', err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

/**
 * @param {ChannelInfo} info
 * @return {String}
 */
var getChannelTitleFromInfo = function (info) {
    return info.title || info.id;
};

/**
 * @param {String} channelId
 * @return {Promise}
 */
Youtube.prototype.getChannelTitle = function (channelId) {
    return this.getChannelInfo(channelId).then(function (info) {
        return getChannelTitleFromInfo(info) || channelId;
    });
};

/**
 * @param {ChannelInfo} info
 * @return {String}
 */
var getChannelLocalTitleFromInfo = function (info) {
    return info.localTitle || info.title || info.id;
};

/**
 * @param {String} channelId
 * @return {Promise}
 */
Youtube.prototype.getChannelLocalTitle = function (channelId) {
    return this.getChannelInfo(channelId).then(function (info) {
        return getChannelLocalTitleFromInfo(info) || channelId;
    });
};

/**
 * @param {String} channelId
 * @param {String} videoId
 * @return {Promise}
 */
Youtube.prototype.videoIdInList = function(channelId, videoId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT videoId FROM messages WHERE videoId = ? AND channelId = ? LIMIT 1; \
        ', [videoId, channelId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(!!results.length);
            }
        });
    });
};

// from momentjs
var isoRegex = /^PT(?:(-?[0-9,.]*)H)?(?:(-?[0-9,.]*)M)?(?:(-?[0-9,.]*)S)?$/;
function parseIso (inp) {
    var res = inp && parseFloat(inp.replace(',', '.'));
    return (isNaN(res) ? 0 : res);
}
var formatDuration = function (str) {
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
        result = parts.map(function (count) {
            if (count < 10) {
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
 * @param {ChannelInfo} channel
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
        _service: 'youtube',
        _channelName: snippet.channelId,
        _videoId: id,

        url: 'https://youtu.be/' + id,
        publishedAt: snippet.publishedAt,
        title: snippet.title,
        preview: previewList,
        duration: formatDuration(contentDetails.duration),
        channel: {
            title: getChannelLocalTitleFromInfo(channel),
            id: snippet.channelId
        }
    };

    var item = {
        id: videoIdToId(id),
        videoId: id,
        channelId: snippet.channelId,
        publishedAt: snippet.publishedAt,
        data: JSON.stringify(data)
    };

    var insert = function (item) {
        return db.newConnection().then(function (connection) {
            return new Promise(function (resolve, reject) {
                connection.beginTransaction(function (err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            }).then(function () {
                return new Promise(function (resolve, reject) {
                    connection.query('INSERT INTO messages SET ?', item, function (err, results) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(item.id);
                        }
                    });
                });
            }).then(function (messageId) {
                return Promise.all(chatIdList.map(function (id) {
                    return _this.gOptions.msgStack.insertInStack(connection, id, messageId);
                }));
            }).then(function () {
                return new Promise(function (resolve, reject) {
                    connection.commit(function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
            }).catch(function (err) {
                return new Promise(function (resolve) {
                    connection.rollback(resolve);
                }).then(function () {
                    throw err;
                });
            }).finally(function () {
                connection.end();
            });
        });
    };
    return _this.videoIdInList(item.channelId, item.videoId).then(function (exists) {
        if (exists) return;

        return insert(item).then(function () {
            return item;
        });
    }).catch(function (err) {
        debug('insertItem', err);
    });
};

var requestPool = new base.Pool(10);
var insertPool = new base.Pool(15);

/**
 * @param {String[]} _channelIdList
 * @param {boolean} [isFullCheck]
 * @return {Promise}
 */
Youtube.prototype.getVideoList = function(_channelIdList, isFullCheck) {
    var _this = this;

    var getVideoIdsInfo = function (channel, videoIds, chatIdList) {
        var lastPublishedAt = '';

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
                        id: videoIds.join(','),
                        maxResults: 50,
                        pageToken: pageToken,
                        fields: 'items/id,items/snippet,items/contentDetails,nextPageToken',
                        key: _this.config.token
                    },
                    json: true,
                    gzip: true,
                    forever: true
                }).then(function(response) {
                    if (response.statusCode === 503) {
                        throw new CustomError(response.statusCode);
                    }

                    if (response.statusCode !== 200) {
                        debug('Unexpected response %j', response);
                        throw new CustomError('Unexpected response');
                    }

                    return response;
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

            return requestPage().then(function (response) {
                /**
                 * @type {{
                 * [nextPageToken]: String,
                 * items: []
                 * }}
                 */
                var responseBody = response.body;
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

                    return _this.insertItem(channel, chatIdList, id, snippet, contentDetails).then(function (item) {
                        item && newItems.push({
                            service: 'youtube',
                            videoId: item.id,
                            channelId: item.channelId,
                            publishedAt: item.id
                        });
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

        return getPage().then(function () {
            if (lastPublishedAt) {
                return _this.setChannelPublishedAfter(channel.id, lastPublishedAt);
            }
        }).catch(function(err) {
            debug('getVideos error! %s', channel.id, err);
        });
    };

    var requestNewVideoIds = function (/*ChannelInfo*/channel) {
        var videoIds = [];

        var channelId = channel.id;
        var publishedAfter = channel.publishedAfter;
        if (isFullCheck || !publishedAfter) {
            publishedAfter = new Date((parseInt(Date.now() / 1000) - 3 * 24 * 60 * 60) * 1000).toISOString();
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
                        channelId: channelId,
                        maxResults: 50,
                        pageToken: pageToken,
                        fields: 'items/contentDetails/upload/videoId,nextPageToken',
                        publishedAfter: publishedAfter,
                        key: _this.config.token
                    },
                    json: true,
                    gzip: true,
                    forever: true
                }).then(function(response) {
                    if (response.statusCode === 503) {
                        throw new CustomError(response.statusCode);
                    }

                    if (response.statusCode !== 200) {
                        debug('Unexpected response %j', response);
                        throw new CustomError('Unexpected response');
                    }

                    return response;
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

            return requestPage().then(function (response) {
                /**
                 * @type {{
                 * [nextPageToken]: String,
                 * items: []
                 * }}
                 */
                var responseBody = response.body;
                var items = responseBody.items;
                return insertPool.do(function () {
                    var item = items.shift();
                    if (!item) return;

                    var videoId = item.contentDetails.upload.videoId;
                    return _this.gOptions.msgStack.messageExists(videoId).then(function (exists) {
                        if (!exists) {
                            videoIds.push(videoId);
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
        });
    };

    var promise = requestPool.do(function () {
        var channelId = _channelIdList.shift();
        if (!channelId) return;

        return _this.getChannelInfo(channelId).then(function (channel) {
            return _this.gOptions.users.getChatIdsByChannel('youtube', channelId).then(function (chatIdList) {
                if (!channel.id) {
                    debug('Channel info is not found!', channelId);
                    return;
                }

                return requestNewVideoIds(channel).then(function (videoIds) {
                    return getVideoIdsInfo(info, videoIds, chatIdList);
                });
            });
        });
    });

    var newItems = [];
    return promise.then(function () {
        return newItems;
    });
};

/**
 * @param {String} channelId
 * @return {Promise.<string>}
 */
Youtube.prototype.requestChannelLocalTitle = function(channelId) {
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/search',
        qs: {
            part: 'snippet',
            channelId: channelId,
            type: 'channel',
            maxResults: 1,
            fields: 'items/snippet',
            key: _this.config.token
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(response) {
        var responseBody = response.body;
        var localTitle = '';
        responseBody.items.some(function (item) {
            return localTitle = item.snippet.title;
        });
        return localTitle;
    }).catch(function(err) {
        debug('requestChannelLocalTitle %s error!', channelId, err);
    });
};

/**
 * @param {String} query
 * @return {Promise.<string>}
 */
Youtube.prototype.requestChannelIdByQuery = function(query) {
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/search',
        qs: {
            part: 'snippet',
            q: JSON.stringify(query),
            type: 'channel',
            maxResults: 1,
            fields: 'items(id)',
            key: _this.config.token
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(response) {
        var responseBody = response.body;

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
 * @param {String} username
 * @return {Promise.<{id: string, username: username}>}
 */
Youtube.prototype.requestChannelIdByUsername = function(username) {
    var _this = this;
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
    }).then(function(response) {
        var responseBody = response.body;

        var id = '';
        responseBody.items.some(function (item) {
            return id = item.id;
        });
        if (!id) {
            throw new CustomError('Channel ID is not found by username!');
        }

        return {id: id, username: username};
    });
};

/**
 * @param {String} url
 * @return {Promise.<string>}
 */
Youtube.prototype.requestChannelIdByVideoUrl = function (url) {
    var _this = this;

    var videoId = '';
    [
        /\/\/(?:[^\/]+\.)?youtu\.be\/([\w\-]+)/,
        /\/\/(?:[^\/]+\.)?youtube\.com\/.+[?&]v=([\w\-]+)/,
        /\/\/(?:[^\/]+\.)?youtube\.com\/(?:.+\/)?(?:v|embed)\/([\w\-]+)/
    ].some(function (re) {
        var m = re.exec(url);
        if (m) {
            videoId = m[1];
            return true;
        }
    });

    if (!videoId) {
        return Promise.reject(new CustomError('It not video url!'));
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
    }).then(function(response) {
        var responseBody = response.body;

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
 * @param {String} channelName
 * @return {Promise.<{id, localTitle}>}
 */
Youtube.prototype.getChannelId = function(channelName) {
    var _this = this;

    var channel = {
        id: null,
        title: null,
        localTitle: null
    };

    return _this.requestChannelIdByVideoUrl(channelName).catch(function (err) {
        if (!err instanceof CustomError) {
            throw err;
        }

        if (/^UC/.test(channelName)) {
            return channelName;
        }

        return _this.requestChannelIdByUsername(channelName).then(function (result) {
            channel.username = result.username;
            return result.id;
        }).catch(function(err) {
            if (!err instanceof CustomError) {
                throw err;
            }

            return _this.requestChannelIdByQuery(channelName).then(function(channelId) {
                return _this.requestChannelIdByUsername(channelId).then(function (result) {
                    channel.username = result.username;
                    return result.id;
                });
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
        }).then(function(response) {
            var responseBody = response.body;

            var snippet = null;
            responseBody.items.some(function (item) {
                return snippet = item.snippet;
            });
            if (!snippet) {
                throw new CustomError('Channel is not found');
            }

            channel.id = channelId;
            channel.title = snippet.channelTitle;

            return _this.requestChannelLocalTitle(channelId).then(function (localTitle) {
                if (localTitle && localTitle !== channel.title) {
                    channel.localTitle = localTitle;
                }
            }).then(function() {
                return _this.setChannelInfo(channel);
            }).then(function () {
                return {
                    id: channel.id,
                    localTitle: getChannelLocalTitleFromInfo(channel)
                };
            });
        });
    });
};

module.exports = Youtube;