/** Core UI strings (NFR-11). `{name}` placeholders are filled by `t()`. */
export const en = {
  'app.name': 'VTT',
  'app.loading': 'Loading…',
  'app.error': 'Something went wrong. Please try again.',
  'app.retry': 'Try again',
  'nav.tables': 'Tables',
  'nav.account': 'Account',
  'nav.logout': 'Log out',
  'nav.signedInAs': 'Signed in as {name}',

  'field.username': 'Username',
  'field.displayName': 'Display name',
  'field.password': 'Password',
  'field.passwordHint': 'At least {min} characters.',
  'field.usernameHint': '3–32 characters: letters, digits, “_”, “.” or “-”.',

  'setup.title': 'Set up your instance',
  'setup.intro': 'Create the first account. It becomes the instance administrator.',
  'setup.submit': 'Create administrator',

  'login.title': 'Log in',
  'login.submit': 'Log in',
  'login.invalidCredentials': 'Wrong username or password.',
  'login.rateLimited': 'Too many failed attempts. Try again in {seconds} seconds.',
  'login.disabled': 'This account has been disabled.',

  'account.title': 'Account',
  'account.mustChangePassword': 'Choose a new password before you continue.',
  'account.profile': 'Profile',
  'account.saveProfile': 'Save',
  'account.profileSaved': 'Profile saved.',
  'account.changePassword': 'Change password',
  'account.currentPassword': 'Current password',
  'account.newPassword': 'New password',
  'account.passwordChanged': 'Password changed. Other devices have been signed out.',
  'account.wrongPassword': 'The current password is wrong.',

  'tables.title': 'Your tables',
  'tables.empty': 'You are not part of any table yet. Create one to get started.',
  'tables.new': 'New table',
  'tables.role.gm': 'GM',
  'tables.role.assistant': 'Assistant',
  'tables.role.player': 'Player',
  'tables.role.spectator': 'Spectator',
  'tables.system': '{name} {version}',

  'createTable.title': 'New table',
  'createTable.name': 'Name',
  'createTable.description': 'Description',
  'createTable.system': 'Game system',
  'createTable.noSystems': 'No game system is enabled yet. Ask your administrator to enable one.',
  'createTable.submit': 'Create table',
  'createTable.cancel': 'Cancel',
  'createTable.systemUnavailable': 'That game system is no longer available.',

  'validation.required': 'Required.',
  'validation.tooShort': 'Must be at least {min} characters.',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
