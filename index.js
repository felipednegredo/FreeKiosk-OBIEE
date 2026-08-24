/**
 * @format
 */

import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { installJsCrashHandler } from './src/utils/CrashLog';

// Record fatal JS errors alongside native crashes (Settings -> Advanced shows them)
installJsCrashHandler();

AppRegistry.registerComponent(appName, () => App);
