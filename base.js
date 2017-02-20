/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const fs = require('fs');
const path = require('path');
const debug = require('debug')('app:base');
const Storage = require('./storage');
const Promise = require('bluebird');

var utils = {};
/**
 *
 * @returns {bluebird|exports|module.exports}
 */
utils.loadConfig = function() {
    return Promise.resolve().then(function() {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json')));
    });
};

/**
 *
 * @returns {bluebird|exports|module.exports}
 */
utils.loadLanguage = function() {
    return Promise.resolve().then(function() {
        var language = JSON.parse(fs.readFileSync(path.join(__dirname, 'language.json')));

        for (var key in language) {
            var item = language[key];
            if (Array.isArray(item)) {
                item = item.join('\n');
            }
            language[key] = item;
        }

        return language;
    });
};

utils.storage = new Storage();

/**
 * @param {string} type
 * @param {string} [text]
 * @param {string} [url]
 */
utils.htmlSanitize = function (type, text, url) {
    if (!text) {
        text = type;
        type = '';
    }

    var sanitize = function (text) {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    var sanitizeAttr = function (text) {
        return sanitize(text).replace(/"/g, '&quot;');
    };

    switch (type) {
        case '':
            return sanitize(text);
        case 'a':
            return '<a href="'+sanitizeAttr(url)+'">'+sanitize(text)+'</a>';
        case 'b':
            return '<b>'+sanitize(text)+'</b>';
        case 'strong':
            return '<strong>'+sanitize(text)+'</strong>';
        case 'i':
            return '<i>'+sanitize(text)+'</i>';
        case 'em':
            return '<em>'+sanitize(text)+'</em>';
        case 'pre':
            return '<pre>'+sanitize(text)+'</pre>';
        case 'code':
            return '<code>'+sanitize(text)+'</code>';
    }

    debug("htmlSanitize error, type: " + type + " is not found!");
    throw new Error("htmlSanitize error");
};

utils.getNowStreamPhotoText = function(gOptions, videoItem) {
    var getText = function (stripLen) {
        var textArr = [];

        var title = '';

        var descPart = [];
        if (videoItem.title) {
            descPart.push(title = videoItem.title);
        }
        if (videoItem.channel.title && title.indexOf(videoItem.channel.title) === -1) {
            descPart.push(videoItem.channel.title);
        }
        if (descPart.length) {
            var desc = descPart.join(', ');
            if (stripLen) {
                desc = desc.substr(0, desc.length - stripLen - 3) + '...';
            }
            textArr.push(desc);
        }

        if (videoItem.url) {
            textArr.push(videoItem.url);
        }

        return textArr.join('\n');
    };

    var text = getText();
    if (text.length > 200) {
        text = getText(text.length - 200);
    }

    return text;
};

utils.getNowStreamText = function(gOptions, videoItem) {
    var textArr = [];

    var title = '';

    var line = [];
    if (videoItem.title) {
        line.push(this.htmlSanitize(title = videoItem.title));
    }
    if (videoItem.channel.title && title.indexOf(videoItem.channel.title) === -1) {
        line.push(this.htmlSanitize('i', videoItem.channel.title));
    }
    if (line.length) {
        textArr.push(line.join(', '));
    }

    if (videoItem.url) {
        textArr.push(this.htmlSanitize(videoItem.url));
    }

    return textArr.join('\n');
};

utils.extend = function() {
    var obj = arguments[0];
    for (var i = 1, len = arguments.length; i < len; i++) {
        var item = arguments[i];
        for (var key in item) {
            obj[key] = item[key];
        }
    }
    return obj;
};

/**
 * @param {{}} gOptions
 * @param {String} service
 * @param {String} channelName
 * @return {Promise}
 */
utils.getChannelTitle = function(gOptions, service, channelName) {
    var services = gOptions.services;

    var result;
    if (services[service].getChannelTitle) {
        result = services[service].getChannelTitle(channelName);
    } else {
        result = Promise.resolve(channelName);
    }

    return result;
};

/**
 * @param {{}} gOptions
 * @param {String} service
 * @param {String} channelName
 * @return {Promise}
 */
utils.getChannelLocalTitle = function(gOptions, service, channelName) {
    var services = gOptions.services;

    var result;
    if (services[service].getChannelLocalTitle) {
        result = services[service].getChannelLocalTitle(channelName);
    } else
    if (services[service].getChannelTitle) {
        result = services[service].getChannelTitle(channelName);
    } else {
        result = Promise.resolve(channelName);
    }

    return result;
};

/**
 * @param {String} service
 * @param {String} channelName
 * @return {String}
 */
utils.getChannelUrl = function(service, channelName) {
    var url = '';
    if (service === 'youtube') {
        url = 'https://youtube.com/';
        if (/^UC/.test(channelName)) {
            url += 'channel/';
        } else {
            url += 'user/';
        }
        url += channelName;
    }

    return url;
};

/**
 * @param {number} callPerSecond
 * @constructor
 */
utils.Quote = function (callPerSecond) {
    var getTime = function() {
        return parseInt(Date.now() / 1000);
    };

    var timeCountMap = {};
    var timeout = function () {
        return new Promise(function (resolve) {
            (function wait() {
                var now = getTime();
                if (!timeCountMap[now]) {
                    timeCountMap[now] = 0;
                }
                timeCountMap[now]++;

                if (timeCountMap[now] > callPerSecond) {
                    setTimeout(wait, 1000);
                } else {
                    resolve();
                }
            })();
        });
    };

    /**
     * @param {Function} cb
     * @returns {Function}
     */
    this.wrapper = function(cb) {
        return function () {
            var args = [].slice.call(arguments);

            return timeout().then(function () {
                return cb.apply(null, args);
            }).finally(function () {
                var now = getTime();
                Object.keys(timeCountMap).forEach(function (time) {
                    if (time < now) {
                        delete timeCountMap[time];
                    }
                });
            });
        };
    };
};

utils.getRandomInt = function (min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
};

utils.arrToParts = function (arr, quote) {
    arr = arr.slice(0);

    if (isNaN(quote)) {
        return arr;
    }

    var arrList = [];
    do {
        arrList.push(arr.splice(0, quote));
    } while (arr.length);

    return arrList;
};

utils.getNow = function () {
    return parseInt(Date.now() / 1000);
};

/**
 * @param {Object} obj
 * @param {*} key
 * @param {*} defaultValue
 * @returns {*}
 */
utils.getObjectItem = function (obj, key, defaultValue) {
    var item = obj[key];
    if (!item) {
        item = obj[key] = defaultValue;
    }
    return item;
};

/**
 * @param {Array} arr
 * @param {*} item
 */
utils.removeItemFromArray = function (arr, item) {
    var pos = arr.indexOf(item);
    if (pos !== -1) {
        arr.splice(pos, 1);
    }
};

utils.dDblUpdates = function (updates) {
    var _this = this;
    var dDblUpdates = updates.slice(0);
    var map = {};
    updates.reverse().forEach(function (update) {
        var message = update.message;
        var callbackQuery = update.callback_query;
        var key = null;
        var value = null;
        if (message) {
            key = JSON.stringify(message.from) + JSON.stringify(message.chat);
            value = message.text;
        } else
        if (callbackQuery) {
            key = JSON.stringify(callbackQuery.message.chat) + callbackQuery.message.message_id;
            value = callbackQuery.data;
        }
        if (key && value) {
            var lines = _this.getObjectItem(map, key, []);
            if (lines[0] === value) {
                _this.removeItemFromArray(dDblUpdates, update);
                debug('Skip dbl msg %j', update);
            } else {
                lines.unshift(value);
            }
        }
    });
    return dDblUpdates;
};

utils.pageBtnList = function (btnList, updCommand, page, mediumBtn) {
    page = parseInt(page || 0);
    if (mediumBtn && !Array.isArray(mediumBtn)) {
        mediumBtn = [mediumBtn];
    }
    var maxItemCount = 10;
    var offset = page * maxItemCount;
    var offsetEnd = offset + maxItemCount;
    var countItem = btnList.length;
    var pageList = btnList.slice(offset, offsetEnd);
    if (countItem > maxItemCount || page > 0) {
        var pageControls = [];
        if (page > 0) {
            pageControls.push({
                text: '<',
                callback_data: '/' + updCommand + ' ' + (page - 1)
            });
        }
        if (mediumBtn) {
            pageControls.push.apply(pageControls, mediumBtn);
        }
        if (countItem - offsetEnd > 0) {
            pageControls.push({
                text: '>',
                callback_data: '/' + updCommand + ' ' + (page + 1)
            });
        }
        pageList.push(pageControls);
    } else
    if (mediumBtn) {
        pageList.push(mediumBtn);
    }
    return pageList;
};

var sepRe = /\?/;
utils.noCacheUrl = function (url) {
    var sep = sepRe.test(url) ? '&' : '?';
    return url + sep + '_=' + utils.getNow();
};

utils.arrayToChainPromise = function (arr, callbackPromise) {
    var next = function () {
        var result = null;
        var item = arr.shift();
        if (item) {
            result = callbackPromise(item).then(next);
        } else {
            result = Promise.resolve();
        }
        return result;
    };
    return next();
};

module.exports = utils;