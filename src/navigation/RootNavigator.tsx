import React from 'react';
import { DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { CrystalTabBar } from './CrystalTabBar';
import { navigationRef } from './navRef';
import type { MainTabParamList, RootStackParamList } from './types';
import { RadarScreen } from '../screens/RadarScreen';
import { RelayScreen } from '../screens/RelayScreen';
import { PoolScreen } from '../screens/PoolScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { RelayWebScreen } from '../screens/RelayWebScreen';
import { palette } from '../theme/tokens';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const CrystalTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: palette.accent,
    background: palette.bgTop,
    card: 'rgba(250,252,255,0.98)',
    text: palette.ink,
    border: palette.hairline,
    notification: palette.danger,
  },
};

function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <CrystalTabBar {...props} />}
      screenOptions={{ headerShown: false, lazy: false }}
      initialRouteName="Radar"
    >
      <Tab.Screen name="Radar" component={RadarScreen} />
      <Tab.Screen name="Relay" component={RelayScreen} />
      <Tab.Screen name="Pool" component={PoolScreen} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  return (
    <NavigationContainer ref={navigationRef} theme={CrystalTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: palette.bgTop } }}>
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="RelayWeb" component={RelayWebScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}