/**
 * Created by Anton on 06.12.2015.
 */
var base = require('./base');
var Promise = require('bluebird');
var debug = require('debug')('checker');

var Checker = function(options) {
    "use strict";
    var _this = this;
    this.gOptions = options;

    this.feedTimeout = {};
    this.gcTime = base.getNow();

    options.events.on('check', function() {
        _this.updateList().catch(function(err) {
            debug('updateList error! "%s"', err);
        });
    });

    options.events.on('feed', function(data) {
        var channelId = data['yt:channelId'];

        var videoId = data['yt:videoId'];

        var hasVideoId = options.services.youtube.videoIdInList(channelId, videoId);
        if (hasVideoId) {
            return;
        }

        var isTimeout = _this.isFeedTimeout(channelId);
        if (isTimeout) {
            return;
        }

        // debug('Feed event, %j', data);

        _this.updateList({youtube: [channelId]}).catch(function(err) {
            debug('updateList error! "%s"', err);
        });
    });
};

Checker.prototype.isFeedTimeout = function (id) {
    var result = false;

    var now = base.getNow();
    var feedTimeout = this.feedTimeout;
    if (feedTimeout[id] > now) {
        result = true;
    } else {
        feedTimeout[id] = now + 5 * 60;
    }

    this.gcFeedTimeout();

    return result;
};

Checker.prototype.gcFeedTimeout = function () {
    var now = base.getNow();
    if (this.gcTime > now) {
        return;
    }
    this.gcTime = now + 60 * 60;

    var feedTimeout = this.feedTimeout;
    Object.keys(feedTimeout).forEach(function (id) {
        if (feedTimeout[id] < now) {
            delete feedTimeout[id];
        }
    });
};

Checker.prototype.getChannelList = function() {
    "use strict";
    var serviceList = {};
    var chatList = this.gOptions.storage.chatList;

    for (var chatId in chatList) {
        var chatItem = chatList[chatId];
        for (var service in chatItem.serviceList) {
            var channelList = serviceList[service] = serviceList[service] || [];

            var userChannelList = chatItem.serviceList[service];
            for (var i = 0, channelName; channelName = userChannelList[i]; i++) {
                if (channelList.indexOf(channelName) !== -1) {
                    continue;
                }
                channelList.push(channelName);
            }
        }
    }

    return serviceList;
};

Checker.prototype.cleanServices = function() {
    "use strict";
    var _this = this;
    var serviceChannelList = _this.getChannelList();
    var services = _this.gOptions.services;

    var promiseList = [];

    for (var service in serviceChannelList) {
        if (!serviceChannelList.hasOwnProperty(service)) {
            continue;
        }

        var currentService = services[service];
        if (!currentService) {
            debug('Service "%s" is not found!', service);
            continue;
        }

        var channelList = serviceChannelList[service];

        if (currentService.clean) {
            promiseList.push(currentService.clean(channelList));
        }
    }

    return Promise.all(promiseList);
};

Checker.prototype.updateList = function(filterServiceChannelList) {
    "use strict";
    var _this = this;

    var isFullCheck = !filterServiceChannelList;

    var onGetVideoList = function(videoList, currentService) {
        if (isFullCheck) {
            var subscribeList = [];
            videoList.forEach(function(item) {
                var channelName = item._channelName;
                if (item._service === 'youtube' && subscribeList.indexOf(channelName) === -1) {
                    subscribeList.push(channelName);
                }
            });
            if (subscribeList.length) {
                // debug('Subscribed %s channels! %j', subscribeList.length, subscribeList);
                _this.gOptions.events.emit('subscribe', subscribeList);
            }
        }

        videoList.sort(function(a, b) {
            return a.publishedAt > b.publishedAt;
        });

        var msgStack = _this.gOptions.msgStack;
        videoList.forEach(function (videoItem) {
            msgStack.addInStack(videoItem);
            msgStack.sendLog(videoItem);
        });

        return Promise.all([
            msgStack.save(),
            currentService.saveState()
        ]).then(function () {
            _this.gOptions.events.emit('notifyAll');
        });
    };

    var queue = Promise.resolve();

    if (isFullCheck) {
        queue = queue.then(function() {
            return _this.cleanServices().catch(function (err) {
                debug('cleanServices error! %j', err);
            });
        });
    }

    return Promise.try(function() {
        var serviceChannelList = _this.getChannelList();
        var services = _this.gOptions.services;

        Object.keys(serviceChannelList).forEach(function (service) {
            var currentService = services[service];
            if (!currentService) {
                debug('Service "%s" is not found!', service);
                return;
            }

            var channelList = serviceChannelList[service];

            var filterChannelList = filterServiceChannelList && filterServiceChannelList[service];
            if (filterChannelList && service === 'youtube') {
                channelList = filterChannelList.filter(function(channelName) {
                    return channelList.indexOf(channelName) !== -1;
                });

                if (!channelList.length) {
                    _this.gOptions.events.emit('unsubscribe', filterChannelList);
                }
            }

            queue = queue.finally(function() {
                return currentService.getVideoList(channelList, isFullCheck).then(function(videoList) {
                    return onGetVideoList(videoList, currentService);
                });
            });
        });

        return queue;
    });
};

module.exports = Checker;