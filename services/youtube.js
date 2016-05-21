/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('youtube');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);

var apiQuote = new base.Quote(1000);
requestPromise = apiQuote.wrapper(requestPromise.bind(requestPromise));

var throttle = function(fn, threshhold, scope) {
    threshhold = threshhold || 250;
    var last;
    var deferTimer;
    return function () {
        var context = scope || this;

        var now = Date.now();
        var args = arguments;
        if (last && now < last + threshhold) {
            // hold on to it
            clearTimeout(deferTimer);
            deferTimer = setTimeout(function () {
                last = now;
                fn.apply(context, args);
            }, threshhold);
        } else {
            last = now;
            fn.apply(context, args);
        }
    };
};

var Youtube = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;
    this.config = {};
    this.config.token = options.config.ytToken;

    this.saveStateThrottle = throttle(this.saveState, 250, this);

    this.onReady = base.storage.get(['ytChannelInfo', 'stateList']).then(function(storage) {
        _this.config.stateList = storage.stateList || {};
        _this.config.channelInfo = storage.ytChannelInfo || {};
        _this.refreshCache();
    });
};

Youtube.prototype.refreshCache = function () {
    var channelInfo = this.config.channelInfo;
    var userIdToChannelId = {};
    Object.keys(channelInfo).forEach(function (channelId) {
        var info = channelInfo[channelId];
        if (info.username) {
            userIdToChannelId[info.username] = channelId;
        }
    });
    this.config.userIdToChannelId = userIdToChannelId;
};

Youtube.prototype.saveChannelInfo = function () {
    "use strict";
    this.refreshCache();
    return base.storage.set({
        ytChannelInfo: this.config.channelInfo
    });
};

Youtube.prototype.getChannelInfo = function (channelId) {
    "use strict";
    var obj = this.config.channelInfo[channelId];
    if (!obj) {
        obj = this.config.channelInfo[channelId] = {};
    }
    return obj;
};

Youtube.prototype.removeChannelInfo = function (channelId) {
    "use strict";
    delete this.config.channelInfo[channelId];
    return this.saveChannelInfo();
};

Youtube.prototype.setChannelTitle = function(channelId, title) {
    "use strict";
    if (channelId === title) {
        return Promise.resolve();
    }
    var info = this.getChannelInfo(channelId);
    if (info.title !== title) {
        info.title = title;
        return this.saveChannelInfo();
    }
};

Youtube.prototype.getChannelTitle = function (channelName) {
    "use strict";
    var channelId = channelName;
    if (!channelRe.test(channelId)) {
        channelId = this.config.userIdToChannelId[channelId];
        !channelId && debug('getChannelTitle channelId is not found! %s', channelName);
    }

    var info = this.getChannelInfo(channelId);
    return info.title || channelName;
};

Youtube.prototype.setChannelLocalTitle = function(channelId, title) {
    "use strict";
    if (channelId === title) {
        return Promise.resolve();
    }
    var info = this.getChannelInfo(channelId);
    if (info.localTitle !== title) {
        info.localTitle = title;
        return this.saveChannelInfo();
    }
};

Youtube.prototype.getChannelLocalTitle = function (channelName) {
    "use strict";
    var channelId = channelName;
    if (!channelRe.test(channelId)) {
        channelId = this.config.userIdToChannelId[channelId];
        !channelId && debug('getChannelLocalTitle channelId is not found! %s', channelName);
    }

    var info = this.getChannelInfo(channelId);
    return info.localTitle || info.title || channelName;
};

Youtube.prototype.setChannelUsername = function(channelId, username) {
    "use strict";
    if (channelId === username) {
        return Promise.resolve();
    }
    var info = this.getChannelInfo(channelId);
    if (info.username !== username) {
        info.username = username;
        return this.saveChannelInfo();
    }
};

Youtube.prototype.getChannelUsername = function (channelId) {
    "use strict";

    var info = this.getChannelInfo(channelId);
    return info.username;
};

Youtube.prototype.clean = function(channelNameList) {
    "use strict";
    var _this = this;

    var channelIdList = channelNameList.map(function (channelName) {
        if (channelRe.test(channelName)) {
            return channelName;
        }
        return _this.config.userIdToChannelId[channelName];
    });

    Object.keys(this.config.channelInfo).forEach(function (channelId) {
        if (channelIdList.indexOf(channelId) === -1) {
            debug('Removed from channelInfo %s %j', channelId, _this.config.channelInfo[channelId]);
            _this.removeChannelInfo(channelId);
        }
    });

    var stateList = _this.config.stateList;
    Object.keys(stateList).forEach(function (channelName) {
        if (channelNameList.indexOf(channelName) === -1) {
            delete stateList[channelName];
            debug('Removed from stateList %s', channelName);
            _this.saveStateThrottle();
        }
    });

    return Promise.resolve();
};

Youtube.prototype.addVideoInStateList = function (channelName, videoId) {
    var stateList = this.config.stateList;
    var channelObj = stateList[channelName];
    if (!channelObj) {
        channelObj = stateList[channelName] = {}
    }

    var videoIdObj = channelObj.videoIdList;
    if (!videoIdObj) {
        videoIdObj = channelObj.videoIdList = {}
    }

    videoIdObj[videoId] = parseInt(Date.now() / 1000);

    this.saveStateThrottle();
};

Youtube.prototype.videoIdInList = function(channelName, videoId) {
    "use strict";
    var stateList = this.config.stateList;
    var videoIdObj = stateList[channelName] && stateList[channelName].videoIdList;
    if (!videoIdObj) {
        return false;
    }

    return !!videoIdObj[videoId];
};

Youtube.prototype.saveState = function() {
    "use strict";
    var stateList = this.config.stateList;
    return base.storage.set({
        stateList: stateList
    });
};

Youtube.prototype.getVideoIdFromThumbs = function(snippet) {
    var videoId = null;

    var thumbnails = snippet.thumbnails;
    thumbnails && Object.keys(thumbnails).some(function(quality) {
        var url = thumbnails[quality].url;
        url = url && url.match(/vi\/([^\/]+)/);
        url = url && url[1];
        if (url) {
            videoId = url;
            return true;
        }
    });

    return videoId;
};

Youtube.prototype.apiNormalization = function(channelName, data, isFullCheck, lastRequestTime) {
    "use strict";
    var _this = this;
    if (!data || !Array.isArray(data.items)) {
        debug('Response is empty! %j', data);
        throw 'Response is empty!';
    }

    var stateList = this.config.stateList;
    var channelObj = stateList[channelName];
    if (!channelObj) {
        channelObj = stateList[channelName] = {}
    }

    var videoIdObj = channelObj.videoIdList;
    if (!videoIdObj) {
        videoIdObj = channelObj.videoIdList = {}
    }

    var channelLocalTitle = this.getChannelLocalTitle(channelName);

    data.items = data.items.filter(function(origItem) {
        var snippet = origItem.snippet;

        if (!snippet) {
            debug('Snippet is not found! %j', origItem);
            return false;
        }

        if (snippet.type !== 'upload') {
            return false;
        }

        if (!snippet.publishedAt) {
            debug('publishedAt is not found! %j', origItem);
            return false;
        }

        return true;
    });

    var lastPubTime = 0;

    var videoList = [];
    data.items.forEach(function(origItem) {
        var snippet = origItem.snippet;

        var videoId = _this.getVideoIdFromThumbs(snippet);
        if (!videoId) {
            debug('Video ID is not found! %j', origItem);
            return;
        }

        var pubTime = new Date(snippet.publishedAt).getTime();
        if (lastPubTime < pubTime) {
            lastPubTime = pubTime;
        }

        var previewList = [];

        var thumbnails = snippet.thumbnails;
        thumbnails && Object.keys(thumbnails).forEach(function(quality) {
            var item = thumbnails[quality];
            previewList.push([item.width, item.url]);
        });

        previewList.sort(function(a, b) {
            return a[0] > b[0] ? -1 : 1;
        });

        previewList = previewList.map(function(item) {
            return item[1];
        });

        if (!snippet.thumbnails) {
            debug('Thumbnails is not found! %j', origItem);
        }

        if (videoIdObj[videoId]) {
            return;
        }

        var item = {
            _service: 'youtube',
            _channelName: channelName,
            _videoId: videoId,

            url: 'https://youtu.be/' + videoId,
            publishedAt: snippet.publishedAt,
            title: snippet.title,
            preview: previewList,
            channel: {
                title: channelLocalTitle,
                id: snippet.channelId
            }
        };

        videoList.push(item);
    });

    if (lastPubTime) {
        channelObj.lastRequestTime = lastPubTime + 1000;
    }

    if (isFullCheck) {
        lastRequestTime = parseInt(lastRequestTime / 1000);
        for (var videoId in videoIdObj) {
            if (videoIdObj[videoId] < lastRequestTime) {
                delete videoIdObj[videoId];
            }
        }
    }

    if (Object.keys(videoIdObj).length === 0) {
        delete channelObj.videoIdList;
    }

    if (Object.keys(channelObj).length === 0) {
        delete stateList[channelName];
    }

    return videoList;
};

Youtube.prototype.requestChannelLocalTitle = function(channelName, channelId) {
    "use strict";
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
        forever: true
    }).then(function(response) {
        response = response.body;
        var localTitle = response && response.items && response.items[0] && response.items[0].snippet && response.items[0].snippet.title;
        if (localTitle) {
            return _this.setChannelLocalTitle(channelId, localTitle);
        }
    }).catch(function(err) {
        debug('requestChannelLocalTitle channelName "%s" channelId "%s" error! %s', channelName, channelId, err);
    });
};

Youtube.prototype.requestChannelIdByQuery = function(query) {
    "use strict";
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/search',
        qs: {
            part: 'snippet',
            q: '"' + query + '"',
            type: 'channel',
            maxResults: 1,
            fields: 'items(id)',
            key: _this.config.token
        },
        json: true,
        forever: true
    }).then(function(response) {
        response = response.body;
        var id = response && response.items && response.items[0] && response.items[0].id && response.items[0].id.channelId;
        if (!id) {
            debug('Channel ID "%s" is not found by query! %j', query, response);
            throw 'Channel ID is not found by query!';
        }

        return id;
    });
};

var channelRe = /^UC/;

Youtube.prototype.requestChannelIdByUsername = function(userId) {
    "use strict";
    var _this = this;
    return Promise.try(function() {
        if (_this.config.userIdToChannelId[userId]) {
            return _this.config.userIdToChannelId[userId];
        }

        if (channelRe.test(userId)) {
            return userId;
        }

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
            forever: true
        }).then(function(response) {
            response = response.body;
            var id = response && response.items && response.items[0] && response.items[0].id;
            if (!id) {
                debug('Channel ID "%s" is not found by userId! %j', userId, response);
                throw 'Channel ID is not found by userId!';
            }

            return _this.setChannelUsername(id, userId).then(function() {
                return id;
            });
        });
    });
};

Youtube.prototype.getVideoList = function(channelNameList, isFullCheck) {
    "use strict";
    var _this = this;

    var streamList = [];

    var requestList = channelNameList.map(function(channelName) {
        var stateItem = _this.config.stateList[channelName];

        var lastRequestTime = stateItem && stateItem.lastRequestTime;
        if (isFullCheck || !lastRequestTime) {
            lastRequestTime = Date.now() - 3 * 24 * 60 * 60 * 1000;
        }
        var publishedAfter = new Date(lastRequestTime).toISOString();

        var pageLimit = 100;
        var items = [];
        var getPage = function(pageToken) {
            return _this.requestChannelIdByUsername(channelName).then(function(channelId) {
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
                    forever: true
                }).then(function(response) {
                    response = response.body || {};

                    if (Array.isArray(response.items)) {
                        items.push.apply(items, response.items)
                    }

                    if (pageLimit < 0) {
                        throw 'Page limited!';
                    }

                    if (response.nextPageToken) {
                        pageLimit--;
                        return getPage(response.nextPageToken);
                    }
                });
            }).catch(function(err) {
                debug('Stream list item "%s" page "%s" response error! %s', channelName, pageToken || 0, err);
            });
        };

        return getPage().then(function() {
            return _this.apiNormalization(channelName, {items: items}, isFullCheck, lastRequestTime);
        }).then(function(stream) {
            streamList.push.apply(streamList, stream);
        });
    });

    return Promise.all(requestList).then(function() {
        return streamList;
    });
};

/**
 * Response userId in lowerCase or channelId (case sensitive)
 * @param {String} channelName
 * @returns {*}
 */
Youtube.prototype.getChannelId = function(channelName) {
    "use strict";
    var _this = this;

    return _this.requestChannelIdByUsername(channelName).catch(function(err) {
        if (err !== 'Channel ID is not found by userId!') {
            throw err;
        }

        return _this.requestChannelIdByQuery(channelName).then(function(channelId) {
            channelName = channelId;
            return _this.requestChannelIdByUsername(channelId);
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
            forever: true
        }).then(function(response) {
            response = response.body;
            var snippet = response && response.items && response.items[0] && response.items[0].snippet;
            if (!snippet) {
                debug('Channel "%s" is not found! %j', channelId, response);
                throw 'Channel is not found!';
            }

            var channelTitle = snippet.channelTitle;

            var isChannelId = channelRe.test(channelName);
            if (!isChannelId) {
                channelName = channelName.toLowerCase();
            }

            return Promise.try(function() {
                // check channelTitle from snippet is equal userId
                if (!channelTitle || !isChannelId) {
                    return;
                }

                var channelTitleLow = channelTitle.toLowerCase();

                return _this.requestChannelIdByUsername(channelTitleLow).then(function(channelId) {
                    if (channelId === channelName) {
                        channelName = channelTitleLow;
                    }
                }).catch(function() {
                    debug('Channel title "%s" is not equal userId "%s"', channelTitleLow, channelName);
                });
            }).then(function() {
                return _this.requestChannelLocalTitle(channelName, channelId);
            }).then(function() {
                return _this.setChannelTitle(channelId, channelTitle);
            }).then(function() {
                return channelName;
            });
        });
    });
};

module.exports = Youtube;