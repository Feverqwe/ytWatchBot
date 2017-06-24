/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const base = require('./base');
const debug = require('debug')('app:checker');

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
        var channelId = _this.gOptions.channels.wrapId(data['yt:channelId'], 'youtube');
        var videoId = _this.gOptions.channels.wrapId(data['yt:videoId'], 'youtube');

        options.services.youtube.videoIdInList(videoId).then(function (hasVideoId) {
            if (hasVideoId) {
                return;
            }

            var isTimeout = _this.isFeedTimeout(channelId);
            if (isTimeout) {
                return;
            }

            // debug('Feed event, %j', data);

            return _this.gOptions.users.getChatIdsByChannel(channelId).then(function (chatIds) {
                if (!chatIds.length) {
                    _this.gOptions.events.emit('unsubscribe', [channelId]);
                    return;
                }

                return _this.updateList([channelId]).catch(function (err) {
                    debug('updateList error!', err);
                });
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

/**
 * @return {Promise.<dbChannel[][]>}
 */
Checker.prototype.getServiceChannels = function(channelIds = []) {
    var _this = this;
    var serviceNames = Object.keys(this.gOptions.services);

    var promise = null;
    if (!channelIds.length) {
        promise = _this.gOptions.users.getAllChannels();
    } else {
        promise = _this.gOptions.channels.getChannels(channelIds);
    }

    return promise.then(function (channels) {
        var dDblChannel = [];
        var services = {};
        channels.forEach(function (channel) {
            // todo: rm me!
            if (dDblChannel.indexOf(channel.id) !== -1) {
                debug('Dbl channels! Fix me!');
                return;
            }
            dDblChannel.push(channel.id);

            var channelArray = services[channel.service];
            if (!channelArray) {
                channelArray = services[channel.service] = [];
            }

            channelArray.push(channel);
        });

        Object.keys(services).forEach(function (serviceName) {
            if (serviceNames.indexOf(serviceName) === -1) {
                debug('Service %s is not found! %j', serviceName, services[serviceName]);
                delete services[serviceName];
            }
        });

        return services;
    });
};

Checker.prototype.updateList = function(filterChannelList = []) {
    var _this = this;

    var services = _this.gOptions.services;
    var isFullCheck = filterChannelList.length === 0;

    return _this.getServiceChannels(filterChannelList).then(function (serviceChannelList) {
        var queue = Promise.resolve();

        Object.keys(services).forEach(function (serviceName) {
            var service = services[serviceName];
            var channelList = serviceChannelList[serviceName] || [];

            queue = queue.then(function() {
                return service.getVideoList(channelList, isFullCheck);
            });
        });

        queue = queue.then(function () {
            _this.gOptions.events.emit('checkStack');
        });

        return queue;
    });
};

module.exports = Checker;