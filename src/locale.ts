enum LocaleCode {
  En = 'en',
}

const en = {
  help: 'Hi! I will notify you about new videos on Youtube channels!',
  emptyServiceList: `You don't have channels in watchlist, yet.`,
  enterChannelName:
    'Enter the channel URL or name (also support video URL, username, channel id; example: {example}):',
  channelExists: 'This channel has been added!',
  channelAdded: 'Success! The channel {channelName} has been added!',
  telegramChannelEnter: 'Enter the channel name (example: @telegram):',
  telegramChannelSet: 'Success! The channel {channelName} has been assigned!',
  telegramChannelError: `Oops! I can't add a {channelName} channel!`,
  commandCanceled: 'Command {command} was canceled.',
  channelDontExist: `Oops! Can't find a channel in the watchlist!`,
  channelDeleted: 'Success! The channel {channelName} has been deleted!',
  cleared: 'Success! Watchlist has been cleared!',
  selectDelChannel: 'Select the channel you want to delete',
  channelIsNotFound: 'Oops! Channel {channelName} can not be found!',
  clearSure: 'Are you sure?',
  users: 'Users: {count}',
  channels: 'Channels: {count}',
  preview: 'preview',
  groupNote: ['', "Note for groups: Use 'Reply' to answer."].join('\n'),
  about: 'Source code: https://bit.ly/ytWatchBot\nHosting https://m.do.co/c/f6ae2a246c7d',
};

const languages = {
  [LocaleCode.En]: en,
};

class Locale {
  getMessage(messageName: keyof typeof en) {
    return languages[LocaleCode.En][messageName];
  }
}

const locale = new Locale();

export {locale};

export default Locale;
