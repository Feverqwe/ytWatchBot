/**
 * Created by Anton on 18.12.2015.
 */
"use strict";
const debug = require('debug')('app:pubsub');
const pubSubHubbub = require("pubsubhubbub");
const xmldoc = require("xmldoc");
const base = require("./base");
const qs = require('querystring');
const crypto = require('crypto');
const request = require('request');
const URL = require('url');

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
                debug('[manual] (s) %s', channel.id);
                channel.subscribeExpire = now + _this.config.lease_seconds;
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
                debug('[manual] (u) %s', channelId);
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

PushApi.prototype._subscribe = function (topic, hub, callback) {
    return this._setSubscription('subscribe', topic, hub, callback);
};

PushApi.prototype._unsubscribe = function (topic, hub, callback) {
    return this._setSubscription('unsubscribe', topic, hub, callback);
};

PushApi.prototype._setSubscription = function (mode, topic, hub, callback) {
    const _this = this;
    const options = _this.config;
    const callbackUrl = options.callbackUrl +
        (options.callbackUrl.replace(/^https?:\/\//i, '').match(/\//) ? '' : '/') +
        (options.callbackUrl.match(/\?/) ? '&' : '?') +
        'topic=' + encodeURIComponent(topic) +
        '&hub=' + encodeURIComponent(hub);
    const form = {
        'hub.callback': callbackUrl,
        'hub.mode': mode,
        'hub.topic': topic,
        'hub.verify': 'async',
        'hub.lease_seconds': _this.config.lease_seconds
    };
    if (options.secret) {
        // do not use the original secret but a generated one
        form['hub.secret'] = crypto.createHmac('sha1', options.secret).update(topic).digest('hex');
    }
    const postParams = {
        url: hub,
        headers: options.headers || {},
        form: form,
        encoding: 'utf-8'
    };
    request.post(postParams, function(error, response, responseBody) {
        if (error) {
            return callback(error);
        }

        if (response.statusCode !== 202 && response.statusCode !== 204) {
            var err = new Error('Invalid response status ' + response.statusCode);
            err.responseBody = (responseBody || '').toString();
            return callback(err);
        }

        return callback(null, topic);
    });
};

PushApi.prototype.subscribe = function(channelId) {
    var _this = this;

    return new Promise(function (resolve, reject) {
        var topicUrl = _this.getTopicUrl(channelId);
        _this._subscribe(topicUrl, _this.hubUrl, function (err, topic) {
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
        _this._unsubscribe(topicUrl, _this.hubUrl, function (err, topic) {
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

    pubsub.on('subscribe', function (data) {
        // debug('subscribe %j', data);
        /*const uri = URL.parse(data.topic);
        const query = qs.parse(uri.query);
        const ytChannelId = query.channel_id;
        const channelId = _this.gOptions.channels.wrapId(ytChannelId, 'youtube');
        const now = base.getNow();
        return _this.subscribe(ytChannelId).then(function () {
            debug('[auto] (s) %s', channelId);
            return _this.gOptions.channels.updateChannel(channelId, {
                subscribeExpire: now + _this.config.lease_seconds
            });
        }).catch(function (err) {
            debug('Subscribe error! %s %o', ytChannelId, err);
        });*/
    });

    pubsub.on('unsubscribe', function (data) {
        // debug('unsubscribe %j', data);
        /*const uri = URL.parse(data.topic);
        const query = qs.parse(uri.query);
        const channelId = _this.gOptions.channels.wrapId(query.channel_id, 'youtube');
        debug('[auto] (u) %s', channelId);
        return _this.gOptions.channels.updateChannel(channelId, {
            subscribeExpire: 0
        });*/
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