class ChatSender {
  constructor(/**Main*/main, chat) {
    this.main = main;
    this.chat = chat;
    this.chatId = chat.id;

    this.videoIds = null;
    this.done = false;
  }

  offset = 0;
  getVideoIds() {
    const prevOffset = this.offset;
    this.offset += 10;
    return this.main.db.getVideoIdsByChatId(this.chat.id, 10, prevOffset);
  }

  async next() {
    if (!this.videoIds || !this.videoIds.length) {
      this.videoIds = await this.getVideoIds();
    }

    if (!this.videoIds.length) {
      this.done = true;
      return;
    }

    return this.main.sender.provideVideo(this.videoIds.shift(), async (video) => {
      console.log(this.chat.id, video.id);
    }).catch((err) => {
      if (err.code === 'VIDEO_IS_NOT_FOUND') {
        // pass
      } else {
        throw err;
      }
    }).then(() => {
      // return this.main.db.deleteChatIdVideoId(chat.id, video.id);
    });
  }
}

export default ChatSender;