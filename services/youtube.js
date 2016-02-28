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

    this.onReady = base.storage.get(['userIdToChannelId', 'channelIdToTitle', 'stateList', 'titleList']).then(function(storage) {
        _this.config.token = options.config.ytToken;
        _this.config.userIdToChannelId = storage.userIdToChannelId || {};
        _this.config.channelIdToTitle = storage.channelIdToTitle || {};
        _this.config.stateList = storage.stateList || {};
        _this.config.titleList = storage.titleList || {};
    });
};

Youtube.prototype.clean = function(channelList) {
    "use strict";
    var _this = this;
    var userIdToChannelId = _this.config.userIdToChannelId;
    var channelIdToTitle = _this.config.channelIdToTitle;
    var titleList = _this.config.titleList;
    var stateList = _this.config.stateList;

    var needSave = false;

    for (var userId in userIdToChannelId) {
        if (channelList.indexOf(userId) === -1) {
            delete userIdToChannelId[userId];
            needSave = true;
            debug('Removed from userIdToChannelId %s', userId);
        }
    }

    for (var channelId in channelIdToTitle) {
        if (channelList.indexOf(channelId) === -1) {
            delete channelIdToTitle[channelId];
            needSave = true;
            debug('Removed from channelIdToTitle %s', channelId);
        }
    }

    for (var channelName in titleList) {
        if (channelList.indexOf(channelName) === -1) {
            delete titleList[channelName];
            needSave = true;
            debug('Removed from titleList %s', channelName);
        }
    }

    for (var channelName in stateList) {
        if (channelList.indexOf(channelName) === -1) {
            delete stateList[channelName];
            needSave = true;
            debug('Removed from stateList %s', channelName);
        }
    }

    var promise = Promise.resolve();

    if (needSave) {
        promise = promise.then(function() {
            return base.storage.set({
                userIdToChannelId: userIdToChannelId,
                channelIdToTitle: channelIdToTitle,
                stateList: stateList,
                titleList: titleList
            });
        });
    }

    return promise;
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
        var idItem = origItem.id;

        if (!snippet) {
            debug('Snippet is not found! %j', origItem);
            return false;
        }

        if (!idItem) {
            debug('idItem is not found! %j', origItem);
            return false;
        }

        if (!idItem.videoId) {
            debug('videoId is not found! %j', origItem);
            return false;
        }

        if (snippet.liveBroadcastContent !== 'none') {
            debug('Item is not liveBroadcastContent none! %j', origItem);
            return false;
        }

        if (!snippet.publishedAt) {
            debug('publishedAt is not found! %j', origItem);
            return false;
        }

        return true;
    });

    if (false) {
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

        var getVideoId = function(snippet) {
            var videoId = null;
            var thumbnails = snippet.thumbnails;
            if (!thumbnails) {
                return videoId;
            }

            Object.keys(thumbnails).some(function(quality) {
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
    }

    var lastPubTime = 0;

    var videoList = [];
    data.items.forEach(function(origItem) {
        var snippet = origItem.snippet;
        var idItem = origItem.id;

        var videoId = idItem.videoId;

        var pubTime = new Date(snippet.publishedAt).getTime();
        if (lastPubTime < pubTime) {
            lastPubTime = pubTime;
        }

        var previewList = [];
        ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault', 'default'].forEach(function(type) {
            previewList.push('https://i.ytimg.com/vi/' + videoId + '/' + type + '.jpg');
        });

        if (!snippet.thumbnails) {
            debug('Thumbnails is not found! %j', origItem);
        }

        var isExists = !!videoIdObj[videoId];

        videoIdObj[videoId] = parseInt(Date.now() / 1000);

        if (isExists) {
            return;
        }

        var item = {
            _service: 'youtube',
            _channelName: channelName,

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

Youtube.prototype.setChannelTitle = function(channelName, channelTitle) {
    "use strict";
    var channelNameToTitle = this.config.channelIdToTitle;
    if (!channelTitle) {
        debug('channelTitle is empty! %s', channelName);
        return;
    }

    if (channelNameToTitle[channelName] === channelTitle) {
        return;
    }

    channelNameToTitle[channelName] = channelTitle;
    return base.storage.set({channelIdToTitle: channelNameToTitle});
};

Youtube.prototype.getChannelTitle = function(channelName) {
    "use strict";
    var channelIdToTitle = this.config.channelIdToTitle;

    return channelIdToTitle[channelName] || channelName;
};

Youtube.prototype.getChannelLocalTitle = function(channelName) {
    "use strict";
    var titleList = this.config.titleList;

    return titleList[channelName] || this.getChannelTitle(channelName);
};

Youtube.prototype.requestChannelLocalTitle = function(channelName, channelId) {
    "use strict";
    var _this = this;
    var titleList = this.config.titleList;

    var currentTitle = titleList[channelName];

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
        json: true
    }).then(function(response) {
        var resolve = Promise.resolve();

        response = response.body;
        var title = response && response.items && response.items[0] && response.items[0].snippet && response.items[0].snippet.title;
        if (title && title !== currentTitle) {
            titleList[channelName] = title;
            resolve = resolve.then(function() {
                return base.storage.set({titleList: titleList});
            });
        }

        return resolve;
    }).catch(function(err) {
        debug('requestChannelLocalTitle channelName "%s" channelId "%s" error! %s', channelName, channelId, err);
    });
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

Youtube.prototype.getVideoList = function(channelNameList, isFullCheck) {
    "use strict";
    var _this = this;
    return Promise.resolve().then(function() {
        if (!channelNameList.length) {
            return [];
        }

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
                return _this.getChannelId(channelName).then(function(channelId) {
                    var requestDetails = {
                        method: 'GET',
                        url: 'https://www.googleapis.com/youtube/v3/search',
                        qs: {
                            part: 'snippet',
                            channelId: channelId,
                            maxResults: 50,
                            type: 'video',
                            order: 'date',
                            safeSearch: 'none',
                            pageToken: pageToken,
                            fields: 'items(id,snippet),nextPageToken',
                            publishedAfter: publishedAfter,
                            key: _this.config.token
                        },
                        json: true
                    };

                    if (false) {
                        requestDetails = {
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
                            json: true
                        };
                    }

                    return requestPromise(requestDetails).then(function(response) {
                        response = response.body;

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
    });
};

/**
 * Response userId in lowerCase or channelId (case sensitive)
 * @param {String} channelName
 * @returns {*}
 */
Youtube.prototype.getChannelName = function(channelName) {
    "use strict";
    var _this = this;

    return _this.getChannelId(channelName).catch(function(err) {
        if (err !== 'Channel ID is not found by userId!') {
            throw err;
        }

        return _this.searchChannelIdByTitle(channelName).then(function(channelId) {
            channelName = channelId;
            return _this.getChannelId(channelId);
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
            json: true
        }).then(function(response) {
            response = response.body;
            var snippet = response && response.items && response.items[0] && response.items[0].snippet;
            if (!snippet) {
                debug('Channel "%s" is not found! %j', channelId, response);
                throw 'Channel is not found!';
            }

            var channelTitle = snippet.channelTitle;

            if (!/^UC/.test(channelName)) {
                channelName = channelName.toLowerCase();
            }

            return Promise.try(function() {
                // check channelTitle from snippet is equal userId
                if (!channelTitle || !/^UC/.test(channelName)) {
                    return;
                }

                var channelTitleLow = channelTitle.toLowerCase();

                return _this.getChannelId(channelTitleLow).then(function(channelId) {
                    if (channelId === channelName) {
                        channelName = channelTitleLow;
                    }
                }).catch(function() {
                    debug('Channel title "%s" is not equal userId "%s"', channelTitleLow, channelName);
                });
            }).then(function() {
                return _this.requestChannelLocalTitle(channelName, channelId);
            }).then(function() {
                return _this.setChannelTitle(channelName, channelTitle);
            }).then(function() {
                return channelName;
            });
        });
    });
};

module.exports = Youtube;