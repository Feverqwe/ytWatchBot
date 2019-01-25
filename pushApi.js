/**
 * Created by Anton on 18.12.2015.
 */
"use strict";
const debug = require('debug')('app:pubsub');
const pubSubHubbub = require("pubsubhubbub");
const xmldoc = require("xmldoc");
const base = require("./base");
const qs = require('querystring');

var PushApi = function(options) {
    var _this = this;
    this.gOptions = options;

    this.config = this.gOptions.config.push;

    this.hubUrl = 'https://pubsubhubbub.appspot.com/subscribe';

    this.pubsub = pubSubHubbub.createServer(this.gOptions.config.push);

    this.onReady = new Promise(function(resolve, reject) {
        _this.initListener(function (err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });

    var requestPool = new base.Pool(10);

    _this.gOptions.events.on('subscribe', function(/*dbChannel[]*/channels) {
        if (!Array.isArray(channels)) {
            channels = [channels];
        }

        var now = base.getNow();

        const subscribeChannels = channels.filter(function (channel) {
            return channel.subscribeExpire < now;
        });
        requestPool.do(function () {
            var channel = subscribeChannels.shift();
            if (!channel) return;

            var ytChannelId = _this.gOptions.channels.unWrapId(channel.id);
            return _this.subscribe(ytChannelId).then(function () {
                // debug('[manual] (s) %s', channel.id);
                channel.subscribeExpire = now + (_this.config.lease_seconds / 2);
                return _this.gOptions.channels.updateChannel(channel.id, {
                    subscribeExpire: channel.subscribeExpire
                });
            }).catch(function (err) {
                debug('Subscribe error! %s %o', channel.id, err);
            });
        });
    });

    _this.gOptions.events.on('unsubscribe', function(channelIds) {
        if (!Array.isArray(channelIds)) {
            channelIds = [channelIds];
        }

        requestPool.do(function () {
            var channelId = channelIds.shift();
            if (!channelId) return;

            const ytChannelId = _this.gOptions.channels.unWrapId(channelId);
            return _this.unsubscribe(ytChannelId).then(function () {
                // debug('[manual] (u) %s', channelId);
                return _this.gOptions.channels.updateChannel(channelId, {
                    subscribeExpire: 0
                });
            }).catch(function (err) {
                debug('Unsubscribe error! %s %o', channelId, err);
            });
        });
    });
};

PushApi.prototype.getTopicUrl = function (channelId) {
    const url = 'https://www.youtube.com/xml/feeds/videos.xml';
    return url + '?' + qs.stringify({
        channel_id: channelId
    });
};

PushApi.prototype.subscribe = function(channelId) {
    var _this = this;

    return new Promise(function (resolve, reject) {
        var topicUrl = _this.getTopicUrl(channelId);
        _this.pubsub.subscribe(topicUrl, _this.hubUrl, function (err, topic) {
            if (err) {
                reject(err);
            } else {
                // debug('Subscribe %s', channelId);
                resolve(topic);
            }
        });
    });
};

PushApi.prototype.unsubscribe = function(channelId) {
    var _this = this;

    return new Promise(function (resolve, reject) {
        var topicUrl = _this.getTopicUrl(channelId);
        _this.pubsub.unsubscribe(topicUrl, _this.hubUrl, function (err, topic) {
            if (err) {
                reject(err);
            } else {
                // debug('Unsubscribed! %s', channelId);
                resolve(topic);
            }
        });
    });
};

PushApi.prototype.initListener = function(callback) {
    var _this = this;
    var pubsub = this.pubsub;

    pubsub.on("listen", function () {
        callback();
    });

    pubsub.on('error', function(err) {
        callback(err);
        debug('Error', err);
    });

    pubsub.on('denied', function(err) {
        debug('Denied', err);
    });

    pubsub.on('feed', function(data) {
        try {
            var feed = _this.prepareData(data.feed.toString());
            _this.gOptions.events.emit('feed', feed);
        } catch (err) {
            if (err.message === 'Entry is not found!') {
                return;
            }

            debug('Parse xml error!', err);
        }
    });

    this.pubsub.listen(_this.gOptions.config.push.port);
};

PushApi.prototype.prepareData = function(xml) {
    var document = new xmldoc.XmlDocument(xml);

    var getChildNode = function(root, name) {
        var el = null;
        if (!root || !root.children) {
            return el;
        }
        for (var i = 0, node; node = root.children[i]; i++) {
            if (node.name === name) {
                return node;
            }
        }
        return el;
    };

    var entry = getChildNode(document, 'entry');

    if (!entry) {
        var isDeletedEntry = !!getChildNode(document, 'at:deleted-entry');
        if (!isDeletedEntry) {
            debug('Unknown entry %j', document.toString({compressed: true}));
        }
        throw new Error('Entry is not found!');
    }

    var data = {};

    var success = ['yt:videoId', 'yt:channelId'].every(function(item) {
        var node = getChildNode(entry, item);
        if (!node) {
            return false;
        }

        data[item] = node.val;

        return !!data[item];
    });

    if (!success) {
        debug('XML read error! %j', document.toString({compressed: true}));
        throw new Error('XML read error!');
    }

    return data;
};

module.exports = PushApi;