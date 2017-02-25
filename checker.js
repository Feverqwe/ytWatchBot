/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
var base = require('./base');
var debug = require('debug')('app:checker');

var Checker = function(options) {
    var _this = this;
    this.gOptions = options;

    this.feedTimeout = {};
    this.gcTime = base.getNow();

    options.events.on('check', function() {
        _this.updateList().catch(function(err) {
            debug('updateList error!', err);
        });
    });

    options.events.on('feed', function(data) {
        var channelId = data['yt:channelId'];

        var videoId = data['yt:videoId'];

        options.services.youtube.videoIdInList(channelId, videoId).then(function (hasVideoId) {
            if (hasVideoId) {
                return;
            }

            var isTimeout = _this.isFeedTimeout(channelId);
            if (isTimeout) {
                return;
            }

            // debug('Feed event, %j', data);

            return _this.updateList({youtube: [channelId]}).catch(function(err) {
                debug('updateList error!', err);
            });
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
    var _this = this;
    return _this.gOptions.users.getAllChannels().then(function (channels) {
        var serviceList = {};
        channels.forEach(function (item) {
            var channelList = serviceList[item.service];
            if (!channelList) {
                channelList = serviceList[item.service] = [];
            }
            channelList.push(item.channelId);
        });
        return serviceList;
    });
};

Checker.prototype.updateList = function(filterServiceChannelList) {
    var _this = this;
    if (!filterServiceChannelList) {
        filterServiceChannelList = {};
    }

    var services = _this.gOptions.services;

    return _this.getChannelList().then(function (serviceUserChannelList) {
        var queue = Promise.resolve();

        Object.keys(services).forEach(function (serviceName) {
            var service = services[serviceName];
            var userChannelList = serviceUserChannelList[serviceName] || [];
            var filterChannelList = filterServiceChannelList[serviceName];
            var isFullCheck = !filterChannelList;

            if (filterChannelList) {
                userChannelList = filterChannelList.filter(function(channelName) {
                    return userChannelList.indexOf(channelName) !== -1;
                });

                if (!userChannelList.length) {
                    _this.gOptions.events.emit('unsubscribe', filterChannelList);
                }
            }

            queue = queue.then(function() {
                return service.getVideoList(userChannelList, isFullCheck);
                /**
                 * @typedef {{}} stackItem
                 * @property {String} channelId
                 * @property {String} videoId
                 * @property {String} publishedAt
                 * @property {String} data
                 */
            }).then(function (/*[stackItem]*/items) {
                if (isFullCheck && items.length) {
                    var channelList = [];
                    items.forEach(function (item) {
                        if (channelList.indexOf(item.channelId) === -1) {
                            channelList.push(item.channelId);
                        }
                    });
                    _this.gOptions.events.emit('subscribe', channelList);
                }
            });
        });

        queue = queue.then(function () {
            _this.gOptions.events.emit('checkStack');
        });

        return queue;
    });
};

module.exports = Checker;