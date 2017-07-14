/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const base = require('./base');
const debug = require('debug')('app:checker');

var Checker = function(options) {
    var _this = this;
    this.gOptions = options;

    this.feedTimeout = new Map();
    this.gcFeedTime = base.getNow();

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

            return _this.inStack(channelId);
        });
    });
};

Checker.prototype.stackUpdateList = function (channelId) {
    const _this = this;
    _this.gOptions.channels.getChannels([channelId]).then(function (channels) {
        let result = null;
        if (channels.length) {
            result = _this.updateList(channels);
        } else {
            _this.gOptions.events.emit('unsubscribe2', [channelId]);
        }
        return result;
    }).catch(function (err) {
        debug('stackUpdateList error!', err);
    });
};

Checker.prototype.inStack = function (id) {
    const _this = this;
    const feedTimeout = this.feedTimeout;
    const now = base.getNow();

    let item = feedTimeout.get(id);
    if (!item) {
        feedTimeout.set(id, item = {});
    }

    const update = function () {
        item.timer = null;
        item.expire = now + 5 * 60;
        _this.stackUpdateList(id);
    };

    if (!item.expire || item.expire < now) {
        update();
    } else
    if (!item.timer) {
        item.timer = setTimeout(update, 5 * 60 * 1000);
    }

    if (this.gcFeedTime < now) {
        this.gcFeedTime = now + 60 * 60;
        feedTimeout.forEach(function (item, id) {
            if (!item.timer && item.expire < now) {
                feedTimeout.delete(id);
            }
        });
    }
};

/**
 * @return {Promise.<dbChannel[][]>}
 */
Checker.prototype.getServiceChannels = function(channels = []) {
    var _this = this;
    var serviceNames = Object.keys(this.gOptions.services);

    var promise = null;
    if (channels.length) {
        promise = Promise.resolve(channels);
    } else {
        promise = _this.gOptions.users.getAllChannels();
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

Checker.prototype.updateList = function(channels = []) {
    var _this = this;

    var services = _this.gOptions.services;
    var isFullCheck = channels.length === 0;

    return _this.getServiceChannels(channels).then(function (serviceChannelList) {
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