/**
 * Created by Anton on 21.05.2016.
 */
var base = require('./base');
var debug = require('debug')('MsgStack');
var debugLog = require('debug')('MsgStack:log');
debugLog.log = console.log.bind(console);
var Promise = require('bluebird');

var MsgStack = function (options) {
    "use strict";
    var _this = this;
    this.gOptions = options;
    this.config = {};

    this.msgStackObj = this.gOptions.storage.msgStack;
    this.chatMsgStack = this.gOptions.storage.chatMsgStack;
    this.saveThrottle = base.throttle(this.save, 100, this);

    this.inProgressChatId = [];

    options.events.on('notifyAll', function (videoList) {
        return _this.notifyAll(videoList);
    });
};

MsgStack.prototype.getChatIdList = function (videoItem) {
    var chatList = this.gOptions.storage.chatList;
    var chatIdList = [];
    for (var chatId in chatList) {
        var chatItem = chatList[chatId];
        var userChannelList = chatItem.serviceList && chatItem.serviceList[videoItem._service];
        if (!userChannelList) {
            continue;
        }
        if (userChannelList.indexOf(videoItem._channelName) === -1) {
            continue;
        }
        chatIdList.push(chatItem.chatId);
    }
    return chatIdList;
};

MsgStack.prototype.addInStack = function (videoItem) {
    var msgStackObj = this.msgStackObj;
    var chatMsgStack = this.chatMsgStack;
    var msgId = videoItem._videoId;
    msgStackObj[msgId] = videoItem;
    this.getChatIdList(videoItem).forEach(function (chatId) {
        var msgStack = base.getObjectItemOrArray(chatMsgStack, chatId);
        base.removeItemFromArray(msgStack, msgId);
        msgStack.push(msgId);
    });
};

MsgStack.prototype.clear = function () {
    var msgStackObj = this.msgStackObj;
    var chatMsgStack = this.chatMsgStack;
    var chatList = this.gOptions.storage.chatList;

    var usedMsgId = [];
    Object.keys(chatMsgStack).forEach(function (chatId) {
        if (!chatList[chatId]) {
            delete chatMsgStack[chatId];
            return;
        }

        var msgStack = chatMsgStack[chatId] || [];
        usedMsgId.push.apply(usedMsgId, msgStack);
    });

    Object.keys(msgStackObj).forEach(function (msgId) {
        if (usedMsgId.indexOf(msgId) === -1) {
            delete msgStackObj[msgId];
        }
    });
};

MsgStack.prototype.callMsgList = function (chatId, chatMsgStack, msgStackObj) {
    var _this = this;
    var msgList = chatMsgStack[chatId];
    if (!msgList) {
        return Promise.resovle();
    }

    var sendNextMsg = function () {
        if (!msgList.length) {
            delete chatMsgStack[chatId];
            return;
        }

        return Promise.try(function () {
            var msgId = msgList[0];
            var videoItem = msgStackObj[msgId];
            if (!videoItem) {
                debug('VideoItem is not found! %s', msgId);
                return;
            }

            var text = base.getNowStreamPhotoText(_this.gOptions, videoItem);
            var noPhotoText = base.getNowStreamText(_this.gOptions, videoItem);

            return _this.gOptions.checker.sendNotify([chatId], text, noPhotoText, videoItem, true).then(function () {
                base.removeItemFromArray(msgList, msgId);
                return _this.saveThrottle();
            }).catch(function (e) {
                debug('sendNotify error! %s', e);

                throw e;
            });
        }).then(function () {
            return sendNextMsg();
        }).catch(function (e) {
            debug('sendNextMsg error! %s', e);
        });
    };

    return sendNextMsg();
};

MsgStack.prototype.save = function () {
    var chatMsgStack = this.chatMsgStack;
    var msgStackObj = this.msgStackObj;

    return base.storage.set({
        chatMsgStack: chatMsgStack,
        msgStack: msgStackObj
    });
};

MsgStack.prototype.callStack = function () {
    var _this = this;
    var inProgressChatId = this.inProgressChatId;
    var chatMsgStack = this.chatMsgStack;
    var msgStackObj = this.msgStackObj;
    var promiseList = [];
    Object.keys(chatMsgStack).map(function (chatId) {
        if (inProgressChatId.indexOf(chatId) !== -1) {
            return;
        }
        inProgressChatId.push(chatId);

        var promise = _this.callMsgList(chatId, chatMsgStack, msgStackObj).then(function () {
            base.removeItemFromArray(inProgressChatId, chatId);
        });
        promiseList.push(promise);
    });
    return Promise.all(promiseList);
};

MsgStack.prototype.sendLog = function (stream) {
    var debugItem = JSON.parse(JSON.stringify(stream));
    delete debugItem.preview;
    delete debugItem._videoId;
    delete debugItem._photoId;
    debugLog('[s] %j', debugItem);
};

MsgStack.prototype.notifyAll = function (videoList) {
    var _this = this;

    videoList.forEach(function (videoItem) {
        _this.addInStack(videoItem);
        _this.sendLog(videoItem);
    });

    return _this.save().then(function () {
        return _this.callStack();
    }).then(function () {
        _this.clear();
        return _this.save();
    });
};

module.exports = MsgStack;