import { useEffect, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform } from 'react-native';

/**
 * 键盘高度钩子。
 * Android 的 Modal 是独立窗口，不吃 activity 的 adjustResize，
 * 所以弹层里的输入框必须自己按键盘高度上移，否则会被键盘盖住。
 */
export function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(show, (e: any) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setH(e?.endCoordinates?.height ?? 0);
    });
    const d = Keyboard.addListener(hide, () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setH(0);
    });
    return () => {
      s.remove();
      d.remove();
    };
  }, []);
  return h;
}