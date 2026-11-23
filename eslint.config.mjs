import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'android-app/**/*', 'backend-fastapi/**/*'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
