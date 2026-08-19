/**
 * FreeKiosk v1.2 - SettingsInput Component
 * A text input with label and validation
 */

import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ViewStyle, KeyboardTypeOptions, TouchableOpacity } from 'react-native';
import { Colors, Spacing, Typography } from '../../theme';
import Icon, { IconName } from '../Icon';

interface SettingsInputProps {
  label: string;
  hint?: string;
  icon?: IconName;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  maxLength?: number;
  disabled?: boolean;
  error?: string;
  style?: ViewStyle;
  inputStyle?: ViewStyle;
  multiline?: boolean;
  onBlur?: () => void;
  onFocus?: () => void;
}

// Uses native secureTextEntry for password masking - no manual bullet management.
// Custom bullet masking (•) caused extra characters on certain Android keyboards
// (Samsung, Gboard predictive text, autocorrect, paste) because it reconstructed
// the real value from display text lengths, which breaks with composing input.
// This is the same fix applied to PinInput in v1.2.5.
const SettingsInput: React.FC<SettingsInputProps> = ({
  label,
  hint,
  icon,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  secureTextEntry = false,
  autoCapitalize = 'none',
  maxLength,
  disabled = false,
  error,
  style,
  inputStyle,
  multiline = false,
  onBlur,
  onFocus,
}) => {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  return (
    <View style={[styles.container, style]}>
      <View style={styles.labelRow}>
        {icon && <Icon name={icon} size={18} color={disabled ? Colors.textDisabled : Colors.textSecondary} style={styles.icon} />}
        <Text style={[styles.label, disabled && styles.labelDisabled]}>{label}</Text>
      </View>
      
      <View style={styles.inputContainer}>
        <TextInput
          style={[
            styles.input,
            disabled && styles.inputDisabled,
            error && styles.inputError,
            multiline && styles.inputMultiline,
            secureTextEntry && styles.inputWithIcon,
            inputStyle,
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.textHint}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry && !isPasswordVisible}
          autoCapitalize={autoCapitalize}
          maxLength={maxLength}
          editable={!disabled}
          multiline={multiline}
          onBlur={onBlur}
          onFocus={onFocus}
          cursorColor={Colors.primary}
          selectionColor={Colors.primaryLight}
          caretHidden={false}
          underlineColorAndroid="transparent"
          autoCorrect={false}
          spellCheck={false}
          textContentType="none"
          importantForAutofill="no"
          autoComplete="off"
        />

        {secureTextEntry && (
          <TouchableOpacity
            style={styles.visibilityToggle}
            onPress={() => setIsPasswordVisible(!isPasswordVisible)}
            disabled={disabled}
          >
            <Icon
              name={isPasswordVisible ? 'eye-off' : 'eye'}
              size={22}
              color={disabled ? Colors.textDisabled : Colors.textSecondary}
            />
          </TouchableOpacity>
        )}
      </View>
      
      {error && <Text style={styles.error}>{error}</Text>}
      {hint && !error && <Text style={[styles.hint, disabled && styles.hintDisabled]}>{hint}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.md,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  icon: {
    marginRight: Spacing.sm,
  },
  label: {
    ...Typography.label,
  },
  labelDisabled: {
    color: Colors.textDisabled,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: Spacing.inputHeight,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Spacing.inputRadius,
    paddingHorizontal: Spacing.inputPadding,
    paddingVertical: Spacing.sm,
    fontSize: 16,
    backgroundColor: Colors.surfaceVariant,
    color: Colors.textPrimary,
  },
  inputWithIcon: {
    paddingRight: 48,
  },
  inputDisabled: {
    backgroundColor: Colors.borderLight,
    color: Colors.textDisabled,
  },
  inputError: {
    borderColor: Colors.error,
    borderWidth: 2,
  },
  inputMultiline: {
    height: 100,
    textAlignVertical: 'top',
    paddingTop: Spacing.md,
  },
  visibilityToggle: {
    position: 'absolute',
    right: 0,
    height: '100%',
    width: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hint: {
    ...Typography.hint,
    marginTop: Spacing.xs,
  },
  hintDisabled: {
    color: Colors.textDisabled,
  },
  error: {
    ...Typography.hint,
    color: Colors.error,
    marginTop: Spacing.xs,
  },
});

export default SettingsInput;
