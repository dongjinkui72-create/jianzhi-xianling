import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/** 全局导航引用：让不在导航树里的组件（如启动流程）也能跳转 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();