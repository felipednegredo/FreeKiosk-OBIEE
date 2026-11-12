/**
 * FreeKiosk - EventContentEditor Component
 * "What to show" part of a planner event: a single page, a rotation of pages
 * or a playlist of images/videos.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Spacing, Typography } from '../../theme';
import { ScheduleContentType } from '../../types/planner';
import SettingsInput from './SettingsInput';

interface EventContentEditorProps {
  contentType: ScheduleContentType;
  onContentTypeChange: (type: ScheduleContentType) => void;
  text: string; // one URL per line
  onTextChange: (text: string) => void;
  seconds: string; // per-URL / per-image duration, '' = default
  onSecondsChange: (seconds: string) => void;
}

const CONTENT_TYPES: { value: ScheduleContentType; label: string }[] = [
  { value: 'url', label: 'Single page' },
  { value: 'rotation', label: 'Page rotation' },
  { value: 'media', label: 'Images / videos' },
];

const EventContentEditor: React.FC<EventContentEditorProps> = ({
  contentType,
  onContentTypeChange,
  text,
  onTextChange,
  seconds,
  onSecondsChange,
}) => {
  return (
    <View>
      <Text style={styles.label}>What to show</Text>
      <View style={styles.typeRow}>
        {CONTENT_TYPES.map(type => (
          <TouchableOpacity
            key={type.value}
            style={[styles.typeButton, contentType === type.value && styles.typeButtonSelected]}
            onPress={() => onContentTypeChange(type.value)}
          >
            <Text style={[styles.typeText, contentType === type.value && styles.typeTextSelected]}>
              {type.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.spacer} />

      {contentType === 'url' ? (
        <SettingsInput
          label="URL to Display"
          value={text}
          onChangeText={onTextChange}
          placeholder="https://example.com/menu"
          keyboardType="url"
        />
      ) : (
        <>
          <SettingsInput
            label={contentType === 'rotation' ? 'URLs to Rotate' : 'Image / Video URLs'}
            hint="One per line"
            value={text}
            onChangeText={onTextChange}
            placeholder={
              contentType === 'rotation'
                ? 'https://example.com/page1\nhttps://example.com/page2'
                : 'https://example.com/banner.jpg\nhttps://example.com/promo.mp4'
            }
            multiline
          />
          <View style={styles.spacer} />
          <SettingsInput
            label={contentType === 'rotation' ? 'Seconds per URL' : 'Seconds per Image'}
            hint={
              contentType === 'rotation'
                ? 'Empty = the URL Rotation interval (minimum 5)'
                : 'Empty = the Media Player image duration. Videos play to the end.'
            }
            value={seconds}
            onChangeText={value => onSecondsChange(value.replace(/[^0-9]/g, ''))}
            placeholder="30"
            keyboardType="numeric"
            maxLength={5}
          />
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  label: {
    ...Typography.label,
    marginBottom: Spacing.xs,
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  typeButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  typeButtonSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  typeText: {
    ...Typography.body,
    color: Colors.textSecondary,
  },
  typeTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  spacer: {
    height: Spacing.md,
  },
});

export default EventContentEditor;
