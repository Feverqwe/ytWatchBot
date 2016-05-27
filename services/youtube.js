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

var Youtube = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;
    this.config = {};
    this.config.token = options.config.ytToken;

    this.onReady = base.storage.get(['ytChannelInfo', 'stateList']).then(function(storage) {
        _this.config.stateList = storage.stateList || {};
        _this.config.channelInfo = storage.ytChannelInfo || {};
    });
};

Youtube.prototype.saveChannelInfo = function () {
    "use strict";
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
    if (channelId !== title) {
        var info = this.getChannelInfo(channelId);
        if (info.title !== title) {
            info.title = title;
            return this.saveChannelInfo();
        }
    }

    return Promise.resolve();
};

Youtube.prototype.getChannelTitle = function (channelId) {
    "use strict";
    var info = this.getChannelInfo(channelId);
    return info.title || channelId;
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

Youtube.prototype.getChannelLocalTitle = function (channelId) {
    "use strict";
    var info = this.getChannelInfo(channelId);
    return info.localTitle || info.title || channelId;
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

Youtube.prototype.clean = function(channelIdList) {
    "use strict";
    var _this = this;

    Object.keys(this.config.channelInfo).forEach(function (channelId) {
        if (channelIdList.indexOf(channelId) === -1) {
            debug('Removed from channelInfo %s %j', channelId, _this.config.channelInfo[channelId]);
            _this.removeChannelInfo(channelId);
        }
    });

    var needSaveState = false;
    var stateList = _this.config.stateList;
    Object.keys(stateList).forEach(function (channelId) {
        if (channelIdList.indexOf(channelId) === -1) {
            needSaveState = true;
            delete stateList[channelId];
            debug('Removed from stateList %s', channelId);
        }
    });
    needSaveState && _this.saveState();

    return Promise.resolve();
};

Youtube.prototype.videoIdInList = function(channelId, videoId) {
    "use strict";
    var stateList = this.config.stateList;
    var videoIdObj = stateList[channelId] && stateList[channelId].videoIdList;
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

Youtube.prototype.apiNormalization = function(channelId, data, isFullCheck, lastRequestTime) {
    "use strict";
    var _this = this;
    if (!data || !Array.isArray(data.items)) {
        debug('Response is empty! %j', data);
        throw 'Response is empty!';
    }

    var stateList = this.config.stateList;
    var channelObj = stateList[channelId];
    if (!channelObj) {
        channelObj = stateList[channelId] = {}
    }

    var videoIdObj = channelObj.videoIdList;
    if (!videoIdObj) {
        videoIdObj = channelObj.videoIdList = {}
    }

    var channelLocalTitle = this.getChannelLocalTitle(channelId);

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

        var pubTime = parseInt(new Date(snippet.publishedAt).getTime() / 1000);
        if (lastPubTime < pubTime) {
            lastPubTime = pubTime;
        }

        var isExists = !!videoIdObj[videoId];

        videoIdObj[videoId] = parseInt(Date.now() / 1000);

        if (isExists) {
            return;
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

        var item = {
            _service: 'youtube',
            _channelName: channelId,
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
        channelObj.lastRequestTime = lastPubTime + 1;
    }

    if (isFullCheck) {
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
        delete stateList[channelId];
    }

    return videoList;
};

Youtube.prototype.requestChannelLocalTitle = function(channelId) {
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
        debug('requestChannelLocalTitle channelId "%s" error! %s', channelId, err);
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

Youtube.prototype.getVideoList = function(channelIdList, isFullCheck) {
    "use strict";
    var _this = this;

    var streamList = [];

    var requestList = channelIdList.map(function(channelId) {
        var stateItem = _this.config.stateList[channelId];

        var lastRequestTime = stateItem && stateItem.lastRequestTime;
        if (isFullCheck || !lastRequestTime) {
            lastRequestTime = parseInt((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000);
        }
        var publishedAfter = new Date(lastRequestTime * 1000).toISOString();

        var pageLimit = 100;
        var items = [];
        var getPage = function(pageToken) {
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
            }).catch(function(err) {
                debug('Stream list item "%s" page "%s" response error! %s', channelId, pageToken || 0, err);
            });
        };

        return getPage().then(function() {
            return _this.apiNormalization(channelId, {items: items}, isFullCheck, lastRequestTime);
        }).then(function(stream) {
            streamList.push.apply(streamList, stream);
        });
    });

    return Promise.all(requestList).then(function () {
        return _this.saveState();
    }).then(function() {
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

            return _this.setChannelTitle(channelId, channelTitle).then(function () {
                return _this.requestChannelLocalTitle(channelId);
            }).then(function() {
                return channelId;
            });
        });
    });
};

module.exports = Youtube;