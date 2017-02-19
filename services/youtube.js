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
    var db = this.gOptions.db;
    var promise = Promise.resolve();
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
            CREATE TABLE IF NOT EXISTS `ytChannels` ( \
                `_id` INT NOT NULL AUTO_INCREMENT, \
                `id` VARCHAR(255) NOT NULL, \
                `title` TEXT NOT NULL, \
                `localTitle` TEXT NULL, \
                `username` TEXT NULL, \
                `publishedAfter` TEXT NULL, \
            PRIMARY KEY (`_id`),\
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
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
            CREATE TABLE IF NOT EXISTS `ytVideos` ( \
                `_id` INT NOT NULL AUTO_INCREMENT, \
                `id` VARCHAR(255) NOT NULL, \
                `channelId` VARCHAR(255) NOT NULL, \
                `publishedAt` TEXT NOT NULL, \
                `snippet` TEXT NOT NULL, \
            PRIMARY KEY (`_id`), \
            UNIQUE INDEX `id_UNIQUE` (`id` ASC), \
            FOREIGN KEY (`channelId`) \
                REFERENCES `ytChannels` (`id`) \
                ON DELETE CASCADE \
                ON UPDATE CASCADE); \
        ', function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        })
    });
    return promise;
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
            SELECT * FROM ytChannels WHERE id = ? LIMIT 1 \
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

Youtube.prototype.updateChannelPublishedAfter = function (channelId, publishedAfter) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            UPDATE ytChannels SET publishedAfter = ? WHERE id = ? \
        ', [publishedAfter, channelId], function (err, results) {
            if (err) {
                debug('updateChannelPublishedAfter', err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

// todo: unused!
Youtube.prototype.removeChannelInfo = function (channelId) {
    /*delete this.config.channelInfo[channelId];
    return this.saveChannelInfo();*/
};

/**
 * @param {String} channelId
 * @return {Promise}
 */
Youtube.prototype.getChannelTitle = function (channelId) {
    return this.getChannelInfo(channelId).then(function (info) {
        return info.title || channelId;
    });
};

/**
 * @param {String} channelId
 * @return {Promise}
 */
Youtube.prototype.getChannelLocalTitle = function (channelId) {
    return this.getChannelInfo(channelId).then(function (info) {
        return info.localTitle || info.title || channelId;
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
 * @param {String[]} channelIdList
 * @return {Promise}
 */
Youtube.prototype.clean = function(channelIdList) {
    // todo: fix me!
    /*var _this = this;
    var promiseList = [];

    var needSaveState = false;
    var channelInfo = _this.config.channelInfo;
    Object.keys(channelInfo).forEach(function (channelId) {
        if (channelIdList.indexOf(channelId) === -1) {
            delete channelInfo[channelId];
            needSaveState = true;
            // debug('Removed from channelInfo %s %j', channelId, _this.config.channelInfo[channelId]);
        }
    });

    if (needSaveState) {
        promiseList.push(_this.saveChannelInfo());
    }

    needSaveState = false;
    var stateList = _this.config.stateList;
    Object.keys(stateList).forEach(function (channelId) {
        if (channelIdList.indexOf(channelId) === -1) {
            delete stateList[channelId];
            needSaveState = true;
            // debug('Removed from stateList %s', channelId);
        }
    });

    if (needSaveState) {
        promiseList.push(_this.saveState());
    }

    return Promise.all(promiseList);*/
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
            SELECT * FROM ytVideos WHERE id = ? AND channelId = ? LIMIT 1 \
        ', [videoId, channelId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(!!results.length);
            }
        });
    });
};

/**
 * @return {Promise}
 */
// todo: rm it
Youtube.prototype.saveState = function() {
    /*var stateList = this.config.stateList;
    return base.storage.set({
        stateList: stateList
    });*/
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
 * @private
 * @param {{}} snippet
 * @return {String}
 */
Youtube.prototype.getVideoIdFromThumbs = function(snippet) {
    var id = null;

    var thumbnails = snippet.thumbnails;
    thumbnails && Object.keys(thumbnails).some(function(quality) {
        var m = /vi\/([^\/]+)/.exec(thumbnails[quality].url);
        if (m) {
            id = m[1];
            return true;
        }
    });

    return id;
};

/**
 * @param {VideoSnippet} snippet
 * @returns {Promise}
 */
Youtube.prototype.insertItem = function (snippet) {
    var db = this.gOptions.db;
    if (snippet.type !== 'upload') {
        return Promise.resolve();
    }

    var id = this.getVideoIdFromThumbs(snippet);
    if (!id) {
        debug('Video ID is not found! %j', snippet);
        return Promise.resolve();
    }

    var video = {
        id: id,
        channelId: snippet.channelId,
        publishedAt: snippet.publishedAt,
        snippet: JSON.stringify(snippet)
    };

    return new Promise(function (resolve, reject) {
        db.connection.query('\
            INSERT INTO ytVideos SET ? ON DUPLICATE KEY UPDATE ? \
        ', [video, video], function (err, results) {
            if (err) {
                debug('insertItem', err);
            }

            resolve();
        });
    });
};

/**
 * @param {String[]} _channelIdList
 * @param {boolean} isFullCheck
 * @return {Promise}
 */
Youtube.prototype.getVideoList = function(_channelIdList, isFullCheck) {
    var _this = this;

    var requestPages = function (/*ChannelInfo*/info) {
        var channelId = info.id;
        var publishedAfter = info.publishedAfter;
        if (isFullCheck || !publishedAfter) {
            publishedAfter = new Date((parseInt(Date.now() / 1000) - 3 * 24 * 60 * 60) * 1000).toISOString();
        }
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
                    url: 'https://www.googleapis.com/youtube/v3/activities',
                    qs: {
                        part: 'snippet',
                        channelId: channelId,
                        maxResults: 50,
                        pageToken: pageToken,
                        fields: 'items/snippet,nextPageToken',
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
                var promiseList = responseBody.items.map(function (item) {
                    var snippet = item.snippet;
                    if (lastPublishedAt < snippet.publishedAt) {
                        lastPublishedAt = snippet.publishedAt;
                    }
                    return _this.insertItem(snippet);
                });
                return Promise.all(promiseList).then(function () {
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
                return _this.updateChannelPublishedAfter(info.id, lastPublishedAt);
            }
        }).catch(function(err) {
            debug('requestPages error! %s', channelId, err);
        });
    };

    var threadCount = 25;
    var partSize = Math.ceil(_channelIdList.length / threadCount);

    var requestList = base.arrToParts(_channelIdList, partSize).map(function (arr) {
        return base.arrayToChainPromise(arr, function (channelId) {
            return _this.getChannelInfo(channelId).then(function (info) {
                if (info.id) {
                    return requestPages(info);
                } else {
                    debug('Channel info is not found!', channelId);
                }
            });
        });
    });

    return Promise.all(requestList).then(function () {
        return [];
    });
};

/**
 * @param {String} channelId
 * @return {Promise}
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
 * @return {Promise}
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
 * @param {String} userId
 * @return {Promise}
 */
Youtube.prototype.requestChannelIdByUsername = function(userId) {
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/channels',
        qs: {
            part: 'snippet',
            forUsername: userId,
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
            throw new CustomError('Channel ID is not found by userId!');
        }

        return {id: id, userId: userId};
    });
};

/**
 * @param {String} url
 * @return {Promise}
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
 * Response userId in lowerCase or channelId (case sensitive)
 * @param {String} channelName
 * @return {Promise}
 */
Youtube.prototype.getChannelId = function(channelName) {
    var _this = this;

    var channel = {
        id: null,
        title: null,
        localTitle: null,
        username: null
    };

    return _this.requestChannelIdByVideoUrl(channelName).catch(function (err) {
        if (!err instanceof CustomError) {
            throw err;
        }

        if (/^UC/.test(channelName)) {
            return channelName;
        }

        return _this.requestChannelIdByUsername(channelName).then(function (idUserId) {
            channel.username = idUserId.userId;
            return idUserId.id;
        }).catch(function(err) {
            if (!err instanceof CustomError) {
                throw err;
            }

            return _this.requestChannelIdByQuery(channelName).then(function(channelId) {
                return _this.requestChannelIdByUsername(channelId).then(function (idUserId) {
                    channel.username = idUserId.userId;
                    return idUserId.id;
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
                return channelId;
            });
        });
    });
};

module.exports = Youtube;