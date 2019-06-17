class Locale {
  getMessage(messageName) {
    return languages.en[messageName].message;
  }
}

const languages = {};

languages.en = {};

export default Locale;