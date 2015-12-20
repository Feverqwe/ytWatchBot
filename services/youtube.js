/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('youtube');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);

Youtube = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;
    this.config = {};

    this.onReady = base.storage.get(['userIdToChannelId', 'channelIdToTitle']).then(function(storage) {
        _this.config.token = options.config.ytToken;
        _this.config.userIdToChannelId = storage.userIdToChannelId || {};
        _this.config.channelIdToTitle = storage.channelIdToTitle || {};
    });
};

Youtube.prototype.clean = function(channelList) {
    "use strict";
    var _this = this;
    var userIdToChannelId = _this.config.userIdToChannelId;
    var channelIdToTitle = _this.config.channelIdToTitle;

    for (var userId in userIdToChannelId) {
        if (channelList.indexOf(userId) === -1) {
            delete userIdToChannelId[userId];
            debug('Removed from userIdToChannelId %s', userId);
        }
    }

    for (var channelId in channelIdToTitle) {
        if (channelList.indexOf(channelId) === -1) {
            delete channelIdToTitle[channelId];
            debug('Removed from channelIdToTitle %s', channelId);
        }
    }

    return base.storage.set({
        userIdToChannelId: userIdToChannelId,
        channelIdToTitle: channelIdToTitle
    });
};

Youtube.prototype.apiNormalization = function(userId, data) {
    "use strict";
    var _this = this;
    if (!data || !Array.isArray(data.items)) {
        debug('Response is empty! %j', data);
        throw 'Response is empty!';
    }

    var lastPubTime = 0;

    var videoList = [];
    data.items.forEach(function(origItem) {
        var snippet = origItem.snippet;

        if (!snippet) {
            debug('Snippet is not found! %j', origItem);
            return;
        }

        if (snippet.publishedAt) {
            var pubTime = new Date(snippet.publishedAt).getTime();
            if (pubTime && lastPubTime < pubTime) {
                lastPubTime = pubTime;
            }
        }

        if (snippet.type !== 'upload') {
            return;
        }

        var previewUrl = null;
        var quality = Object.keys(snippet.thumbnails || {}).slice(-1)[0];
        if (quality) {
            previewUrl = snippet.thumbnails[quality].url;
        }

        if (!previewUrl) {
            debug('Preview url is not found! %j', origItem);
            return;
        }

        var videoId = previewUrl.match(/vi\/([^\/]+)/);
        videoId = videoId && videoId[1];
        if (!videoId) {
            debug('Video ID is not found! %j', origItem);
            return;
        }

        var item = {
            _service: 'youtube',
            _channelName: userId,

            url: 'https://youtu.be/' + videoId,
            publishedAt: snippet.publishedAt,
            title: snippet.title,
            preview: previewUrl,
            // description: snippet.description,
            channel: {
                title: snippet.channelTitle,
                id: snippet.channelId
            }
        };

        videoList.push(item);
    });

    var stateList = this.gOptions.storage.stateList;
    if (lastPubTime) {
        var serviceObj = stateList.youtube;
        if (!serviceObj) {
            serviceObj = stateList.youtube = {};
        }
        var channelObj = serviceObj[userId];
        if (!channelObj) {
            channelObj = serviceObj[userId] = {};
        }
        channelObj.lastRequestTime = lastPubTime + 1000;
    }

    return videoList;
};

Youtube.prototype.getUserId = function(channelId) {
    "use strict";
    var userIdToChannelId = this.config.userIdToChannelId;
    for (var title in userIdToChannelId) {
        var id = userIdToChannelId[title];
        if (id === channelId) {
            return title;
        }
    }
    return null;
};

Youtube.prototype.setChannelTitle = function(channelId, channelTitle) {
    "use strict";
    var channelIdToTitle = this.config.channelIdToTitle;
    if (!channelTitle) {
        debug('channelTitle is empty! %s', channelId);
        return;
    }

    if (channelIdToTitle[channelId] === channelTitle) {
        return;
    }

    channelIdToTitle[channelId] = channelTitle;
    base.storage.set({channelIdToTitle: channelIdToTitle});
};

Youtube.prototype.getChannelTitle = function(channelId) {
    "use strict";
    var channelIdToTitle = this.config.channelIdToTitle;

    return channelIdToTitle[channelId] || channelId;
};

Youtube.prototype.searchChannelIdByTitle = function(channelTitle) {
    "use strict";
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/search',
        qs: {
            part: 'snippet',
            q: '"' + channelTitle + '"',
            type: 'channel',
            maxResults: 1,
            fields: 'items(id)',
            key: _this.config.token
        },
        json: true
    }).then(function(response) {
        response = response.body;
        var id = response && response.items && response.items[0] && response.items[0].id && response.items[0].id.channelId;
        if (!id) {
            debug('Channel ID "%s" is not found by query! %j', channelTitle, response);
            throw 'Channel ID is not found by query!';
        }

        return id;
    });
};

Youtube.prototype.getChannelId = function(userId) {
    "use strict";
    var _this = this;
    return Promise.resolve().then(function() {
        if (_this.config.userIdToChannelId[userId]) {
            return _this.config.userIdToChannelId[userId];
        }

        if (/^UC/.test(userId)) {
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
            json: true
        }).then(function(response) {
            response = response.body;
            var id = response && response.items && response.items[0] && response.items[0].id;
            if (!id) {
                debug('Channel ID "%s" is not found by userId! %j', userId, response);
                throw 'Channel ID is not found by userId!';
            }

            _this.config.userIdToChannelId[userId] = id;
            return base.storage.set({userIdToChannelId: _this.config.userIdToChannelId}).then(function() {
                return id;
            });
        });
    });
};

Youtube.prototype.getVideoList = function(userList) {
    "use strict";
    var _this = this;
    return Promise.resolve().then(function() {
        if (!userList.length) {
            return [];
        }

        var streamList = [];

        var requestList = userList.map(function(item) {
            var userId = item.channelId;
            var lastRequestTime = item.lastRequestTime;
            if (!lastRequestTime) {
                lastRequestTime = Date.now() - 1 * 24 * 60 * 60 * 1000;
            }
            var publishedAfter = new Date(lastRequestTime).toISOString();
            return _this.getChannelId(userId).then(function(channelId) {
                return requestPromise({
                    method: 'GET',
                    url: 'https://www.googleapis.com/youtube/v3/activities',
                    qs: {
                        part: 'snippet',
                        channelId: channelId,
                        maxResults: 50,
                        fields: 'items(snippet)',
                        publishedAfter: publishedAfter,
                        key: _this.config.token
                    },
                    json: true
                }).then(function(response) {
                    response = response.body;

                    return Promise.resolve().then(function() {
                        return _this.apiNormalization(userId, response);
                    }).then(function(stream) {
                        streamList.push.apply(streamList, stream);
                    });
                });
            }).catch(function(err) {
                debug('Stream list item "%s" response error! %s', userId, err);
            });
        });

        return Promise.all(requestList).then(function() {
            return streamList;
        });
    });
};

Youtube.prototype.getChannelName = function(userId) {
    "use strict";
    var _this = this;

    return _this.getChannelId(userId).catch(function(err) {
        if (err !== 'Channel ID is not found by userId!') {
            throw err;
        }

        return _this.searchChannelIdByTitle(userId).then(function(newUserId) {
            userId = newUserId;
            return _this.getChannelId(userId);
        });
    }).then(function(channelId) {
        return requestPromise({
            method: 'GET',
            url: 'https://www.googleapis.com/youtube/v3/search',
            qs: {
                part: 'snippet',
                channelId: channelId,
                maxResults: 1,
                fields: 'items(id,snippet)',
                key: _this.config.token
            },
            json: true
        }).then(function(response) {
            response = response.body;
            var firstItem = response && response.items && response.items[0];
            if (!firstItem || !firstItem.id || !firstItem.snippet) {
                debug('Channel "%s" is not found! %j', channelId, response);
                throw 'Channel is not found!';
            }

            var channelTitle = firstItem.snippet.channelTitle;

            return Promise.try(function() {
                if (!channelTitle || !/^UC/.test(userId)) {
                    return;
                }

                var channelTitleLow = channelTitle.toLowerCase();

                return _this.getChannelId(channelTitleLow).then(function(channelId) {
                    if (channelId === userId) {
                        userId = channelTitleLow;
                    }
                }).catch(function() {
                    debug('Channel title "%s" is not equal userId "%s"', channelTitleLow, userId);
                });
            }).then(function() {
                _this.setChannelTitle(userId, channelTitle);

                return userId;
            });
        });
    });
};

module.exports = Youtube;