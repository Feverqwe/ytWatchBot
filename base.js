/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const fs = require('fs');
const path = require('path');
const debug = require('debug')('app:base');

var utils = {};
/**
 *
 * @returns {Object}
 */
utils.loadConfig = function() {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json')));
};

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
        var lines = [];

        var name = videoItem.title || '';
        var channelName = videoItem.channel.title || '';
        var duration = videoItem.duration || '';
        var url = videoItem.url || '';


        var title = [];
        if (name) {
            title.push(name);
        }
        if (channelName) {
            if (name) {
                title.push('—');
            }
            title.push(channelName);
        }
        var titleLine = title.join(' ');


        var link = [];
        if (url) {
            link.push(url);
        }
        if (duration) {
            link.push(duration);
        }
        var linkLine = link.join(' ');


        if (titleLine) {
            if (stripLen) {
                titleLine = titleLine.substr(0, titleLine.length - stripLen - 3) + '...';
            }

            lines.push(titleLine);
        }
        if (linkLine) {
            lines.push(linkLine);
        }

        return lines.join('\n');
    };

    var text = getText();
    if (text.length > 200) {
        text = getText(text.length - 200);
    }

    return text;
};

utils.getNowStreamText = function(gOptions, videoItem) {
    var lines = [];

    var name = videoItem.title || '';
    var channelName = videoItem.channel.title || '';
    var duration = videoItem.duration || '';
    var url = videoItem.url || '';


    var title = [];
    if (name) {
        title.push(utils.htmlSanitize(name));
    }
    if (channelName) {
        if (name) {
            title.push('—');
        }
        title.push(utils.htmlSanitize(channelName));
    }
    var titleLine = title.join(' ');


    var link = [];
    if (url) {
        link.push(url);
    }
    if (duration) {
        link.push(duration);
    }
    var linkLine = link.join(' ');


    if (titleLine) {
        lines.push(titleLine);
    }
    if (linkLine) {
        lines.push(linkLine);
    }

    return lines.join('\n');
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
    return Math.trunc(Date.now() / 1000);
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

utils.pageBtnList = function (query, btnList, command, mediumBtn) {
    const page = parseInt(query.page || 0);
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
                callback_data: command + '?page=' + (page - 1)
            });
        }
        if (mediumBtn) {
            pageControls.push.apply(pageControls, mediumBtn);
        }
        if (countItem - offsetEnd > 0) {
            pageControls.push({
                text: '>',
                callback_data: command + '?page=' + (page + 1)
            });
        }
        pageList.push(pageControls);
    } else
    if (mediumBtn) {
        pageList.push(mediumBtn);
    }
    return pageList;
};

utils.splitTextToPages = function (text) {
    const maxLen = 4096;

    const textByLines = function (text) {
        const lines = [];
        let line = '';
        for (let i = 0, char = '', len = text.length; i < len; i++) {
            char = text[i];
            line += char;
            if (char === '\n' || line.length === maxLen) {
                lines.push(line);
                line = '';
            }
        }
        if (line.length) {
            lines.push(line);
        }
        return lines;
    };

    const linesByPage = function (lines) {
        const pages = [];
        let page = '';
        lines.forEach(function (line) {
            if (page.length + line.length > maxLen) {
                pages.push(page);
                page = '';
            }
            page += line;
        });
        if (page.length) {
            pages.push(page);
        }
        return pages;
    };

    return linesByPage(textByLines(text));
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