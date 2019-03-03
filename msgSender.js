/**
 * Created by Anton on 02.10.2016.
 */
"use strict";
const debug = require('debug')('app:msgSender');
const got = require('got');
const promiseFinally = require('./tools/promiseFinally');

class MsgSender {
    constructor(options) {
        this.gOptions = options;
        this.messageIdRequestPicturePromise = {};
    }

    getValidPhotoUrl(stream) {
        let requestLimit = this.gOptions.config.sendPhotoRequestLimit || 10;

        const requestTimeoutSec = this.gOptions.config.sendPhotoRequestTimeoutSec || 30;

        const previewList = stream.preview;

        const getHead = (index) => {
            const previewUrl = previewList[index];
            return got.head(previewUrl, {
                timeout: 5 * 1000
            }).then((response) => response.url).catch((err) => {
                if (++index < previewList.length) {
                    return getHead(index);
                }

                if (err.code === 'ETIMEDOUT' || requestLimit-- < 1) {
                    const _err = new Error('REQUEST_PHOTO_ERROR');
                    _err.parentError = err;
                    throw _err;
                }

                return new Promise(resolve => setTimeout(resolve, requestTimeoutSec * 1000)).then(() => {
                    return getHead(0);
                });
            });
        };

        return getHead(0);
    }

    getPicId(chat_id, text, stream) {
        const sendingPic = () => {
            const uploadPhoto = (photoUrl) => {
                return this.gOptions.bot.sendPhoto(chat_id, got.stream(photoUrl), {
                    caption: text
                }, {
                    contentType: 'image/jpeg',
                });
            };

            const sendPhotoUrl = (photoUrl) => {
                return this.gOptions.bot.sendPhoto(chat_id, photoUrl, {
                    caption: text
                });
            };

            return this.getValidPhotoUrl(stream).then((photoUrl) => {
                return sendPhotoUrl(photoUrl).catch((err) => {
                    const errList = [
                        /failed to get HTTP URL content/,
                        /wrong type of the web page content/,
                        /wrong file identifier\/HTTP URL specified/
                    ];
                    let isLoadUrlError = errList.some((re) => {
                        return re.test(err.message);
                    });
                    if (!isLoadUrlError) {
                        isLoadUrlError = err.response && err.response.statusCode === 504;
                    }

                    if (!isLoadUrlError) {
                        throw err;
                    }

                    return uploadPhoto(photoUrl);
                });
            });
        };

        return sendingPic();
    }

    requestPicId(chat_id, messageId, caption, text, data, message) {
        let promise = this.messageIdRequestPicturePromise[messageId];

        if (!promise) {
            promise = this.messageIdRequestPicturePromise[messageId] = this.getPicId(chat_id, caption, data).then(...promiseFinally(() => {
                delete this.messageIdRequestPicturePromise[messageId];
            })).then((msg) => {
                return Promise.resolve().then(() => {
                    const fileId = getPhotoFileIdFromMessage(msg);
                    if (fileId) {
                        message.imageFileId = fileId;
                        return this.gOptions.msgStack.setImageFileId(messageId, fileId);
                    }
                }).then(() => msg);
            });
            promise = promise.catch((err) => {
                if (err.code === 'ETELEGRAM' && /not enough rights to send photos/.test(err.response.body.description)) {
                    throw err;
                }
                return this.send(chat_id, null, caption, text).then((msg) => {
                    debug('getPicId error %j', err.message);
                    return msg;
                });
            });
        } else {
            promise = promise.then((msg) => {
                const fileId = getPhotoFileIdFromMessage(msg);

                return this.send(chat_id, fileId, caption, text);
            }, (err) => {
                if (err.message === 'REQUEST_PHOTO_ERROR') {
                    return this.send(chat_id, null, caption, text);
                } else {
                    return this.requestPicId(chat_id, messageId, caption, text, data, message);
                }
            });
        }

        return promise;
    }

    send(chat_id, imageFileId, caption, text) {
        if (!imageFileId || !caption) {
            return this.gOptions.bot.sendMessage(chat_id, text, {
                parse_mode: 'HTML'
            });
        } else {
            return this.gOptions.bot.sendPhotoQuote(chat_id, imageFileId, {
                caption: caption
            });
        }
    }

    sendMessage(chat_id, messageId, message, data, useCache) {
        const imageFileId = message.imageFileId;
        const caption = message.caption;
        const text = message.text;

        if (!data.preview.length) {
            return this.send(chat_id, imageFileId, caption, text);
        }

        if (!caption) {
            return this.send(chat_id, imageFileId, caption, text);
        }

        if (useCache && imageFileId) {
            return this.send(chat_id, imageFileId, caption, text);
        }

        return this.requestPicId(chat_id, messageId, caption, text, data, message);
    }
}

/**
 * @param {Object} msg
 * @return {string}
 */
const getPhotoFileIdFromMessage = (msg) => {
    let fileId = null;
    msg.photo.slice(0).sort((a, b) => {
        return a.file_size > b.file_size ? -1 : 1;
    }).some((item) => fileId = item.file_id);
    return fileId;
};


module.exports = MsgSender;