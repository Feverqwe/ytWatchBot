const Locale = function (/**Main*/main) {
  this.language = locales.en;
};

const locales = {
  en: {
    "help": "Hi! I will notify you about new videos on Youtube channels!",
    "emptyServiceList": "You don't have channels in watchlist, yet.",
    "enterChannelName": "Enter the channel URL or name (also support video URL, username, channel id; example: NationalGeographic):",
    "channelExists": "This channel has been added!",
    "channelAdded": "Success! The channel {channelName} has been added!",
    "telegramChannelEnter": "Enter the channel name (example: @telegram):",
    "telegramChannelSet": "Success! The channel {channelName} has been assigned!",
    "telegramChannelError": "Oops! I can't add a {channelName} channel!",
    "commandCanceled": "Command {command} was canceled.",
    "channelDontExist": "Oops! Can't find a channel in the watchlist!",
    "channelDeleted": "Success! The channel {channelName} has been deleted!",
    "cleared": "Success! Watchlist has been cleared!",
    "selectDelChannel": "Select the channel you want to delete",
    "channelIsNotFound": "Oops! Channel {channelName} can not be found!",
    "clearSure": "Are you sure?",
    "users": "Users: {count}",
    "channels": "Channels: {count}",
    "preview": "preview",
    "rateMe": [
      "",
      "",
      "⭐️ If you like this bot, please rate us 5 stars in store:",
      "https://telegram.me/storebot?start=ytwatchbot"
    ].join('\n'),
    "groupNote": [
      "",
      "Note for groups: Use \"Reply\" to answer."
    ].join('\n')
  }
};

module.exports = Locale;