/**
 * FreeKiosk v1.2 - URL List Editor Component
 * Manage a list of URLs for rotation
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { Colors, Spacing, Typography } from '../../theme';
import { RotationUrl, getUrlString } from '../../types/rotation';

interface UrlListEditorProps {
  urls: (string | RotationUrl)[];
  onUrlsChange: (urls: (string | RotationUrl)[]) => void;
  maxUrls?: number; // 0 or undefined = unlimited (for patterns), default 10 for URLs
  /** Pattern mode: accept wildcards (*), skip URL normalization */
  patternMode?: boolean;
  /** Rotation mode: allow per-URL duration */
  rotationMode?: boolean;
  defaultInterval?: string;
  placeholder?: string;
  emptyTitle?: string;
  emptyHint?: string;
}

const UrlListEditor: React.FC<UrlListEditorProps> = ({
  urls,
  onUrlsChange,
  maxUrls = 10,
  patternMode = false,
  rotationMode = false,
  defaultInterval = '30',
  placeholder,
  emptyTitle,
  emptyHint,
}) => {
  const [newUrl, setNewUrl] = useState('');

  const validateUrl = (url: string): boolean => {
    const trimmed = url.trim().toLowerCase();
    if (!trimmed) return false;
    
    if (patternMode) {
      // Pattern mode: just needs some content, wildcards are OK
      return trimmed.length >= 2;
    }
    
    // Basic validation - must have a domain
    if (!trimmed.includes('.')) return false;
    
    // Reject dangerous protocols
    if (trimmed.startsWith('file://') || 
        trimmed.startsWith('javascript:') || 
        trimmed.startsWith('data:')) {
      return false;
    }
    
    return true;
  };

  const normalizeUrl = (url: string): string => {
    let trimmed = url.trim();
    
    if (patternMode) {
      // Pattern mode: keep as-is (preserve wildcards)
      return trimmed;
    }
    
    const lower = trimmed.toLowerCase();
    
    // Add https:// if no protocol
    if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
      trimmed = 'https://' + trimmed;
    }
    
    return trimmed;
  };

  const handleAddUrl = () => {
    if (!newUrl.trim()) {
      Alert.alert('Error', patternMode ? 'Please enter a pattern' : 'Please enter a URL');
      return;
    }

    if (!validateUrl(newUrl)) {
      Alert.alert(
        patternMode ? 'Invalid Pattern' : 'Invalid URL', 
        patternMode ? 'Please enter a valid pattern (e.g., *facebook.com*)' : 'Please enter a valid URL (e.g., example.com)'
      );
      return;
    }

    if (maxUrls > 0 && urls.length >= maxUrls) {
      Alert.alert('Limit Reached', `Maximum ${maxUrls} entries allowed`);
      return;
    }

    const normalized = normalizeUrl(newUrl);
    
    // Check for duplicates
    if (urls.some(u => getUrlString(u) === normalized)) {
      Alert.alert('Duplicate', 'This URL is already in the list');
      return;
    }

    const newItem = rotationMode ? { url: normalized } : normalized;
    onUrlsChange([...urls, newItem]);
    setNewUrl('');
  };

  const handleRemoveUrl = (index: number) => {
    const newUrls = urls.filter((_, i) => i !== index);
    onUrlsChange(newUrls);
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newItems = [...urls];
    [newItems[index - 1], newItems[index]] = [newItems[index], newItems[index - 1]];
    onUrlsChange(newItems);
  };

  const handleMoveDown = (index: number) => {
    if (index === urls.length - 1) return;
    const newItems = [...urls];
    [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
    onUrlsChange(newItems);
  };

  const handleIntervalChange = (index: number, text: string) => {
    const newItems = [...urls];
    const current = newItems[index];
    const urlStr = getUrlString(current);

    const numericValue = text.replace(/[^0-9]/g, '');
    const interval = numericValue ? parseInt(numericValue, 10) : undefined;

    newItems[index] = { url: urlStr, interval };
    onUrlsChange(newItems);
  };

  return (
    <View style={styles.container}>
      {/* URL List */}
      {urls.length > 0 ? (
        <View style={styles.urlList}>
          {urls.map((item, index) => {
            const urlStr = getUrlString(item);
            const interval = typeof item === 'object' ? item.interval : undefined;

            return (
              <View key={index} style={styles.urlItemWrapper}>
                <View style={styles.urlItem}>
                  <View style={styles.urlInfo}>
                    <Text style={styles.urlIndex}>{index + 1}</Text>
                    <Text style={styles.urlText} numberOfLines={1}>
                      {urlStr.replace(/^https?:\/\//, '')}
                    </Text>
                  </View>

                  <View style={styles.urlActions}>
                    {/* Move buttons */}
                    <TouchableOpacity
                      style={[styles.actionButton, index === 0 && styles.actionButtonDisabled]}
                      onPress={() => handleMoveUp(index)}
                      disabled={index === 0}
                    >
                      <Text style={styles.actionButtonText}>▲</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.actionButton, index === urls.length - 1 && styles.actionButtonDisabled]}
                      onPress={() => handleMoveDown(index)}
                      disabled={index === urls.length - 1}
                    >
                      <Text style={styles.actionButtonText}>▼</Text>
                    </TouchableOpacity>

                    {/* Delete button */}
                    <TouchableOpacity
                      style={[styles.actionButton, styles.deleteButton]}
                      onPress={() => handleRemoveUrl(index)}
                    >
                      <Text style={styles.deleteButtonText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                
                {rotationMode && (
                  <View style={styles.intervalRow}>
                    <Text style={styles.intervalLabel}>Custom Duration:</Text>
                    <TextInput
                      style={styles.intervalInput}
                      value={interval !== undefined ? String(interval) : ''}
                      onChangeText={(text) => handleIntervalChange(index, text)}
                      placeholder={defaultInterval}
                      placeholderTextColor={Colors.textHint}
                      keyboardType="numeric"
                      maxLength={5}
                    />
                    <Text style={styles.intervalUnit}>seconds</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateIcon}>{patternMode ? '🔗' : '📋'}</Text>
          <Text style={styles.emptyStateText}>{emptyTitle || 'No URLs added yet'}</Text>
          <Text style={styles.emptyStateHint}>{emptyHint || 'Add URLs below to start rotation'}</Text>
        </View>
      )}

      {/* Add URL Input */}
      <View style={styles.addSection}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={newUrl}
            onChangeText={setNewUrl}
            placeholder={placeholder || 'https://example.com'}
            placeholderTextColor={Colors.textHint}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={handleAddUrl}
          />
          <TouchableOpacity
            style={[styles.addButton, (maxUrls > 0 && urls.length >= maxUrls) && styles.addButtonDisabled]}
            onPress={handleAddUrl}
            disabled={maxUrls > 0 && urls.length >= maxUrls}
          >
            <Text style={styles.addButtonText}>+</Text>
          </TouchableOpacity>
        </View>
        
        <Text style={styles.countText}>
          {maxUrls > 0 ? `${urls.length} / ${maxUrls} ${patternMode ? 'patterns' : 'URLs'}` : `${urls.length} ${patternMode ? 'patterns' : 'URLs'}`}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.sm,
  },
  urlList: {
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  urlItemWrapper: {
    backgroundColor: Colors.surfaceVariant,
    borderRadius: Spacing.inputRadius,
    padding: Spacing.xs,
    gap: 4,
  },
  urlItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.xs,
    paddingLeft: Spacing.sm,
  },
  urlInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  urlIndex: {
    ...Typography.labelSmall,
    color: Colors.primary,
    backgroundColor: Colors.primaryLight,
    width: 24,
    height: 24,
    borderRadius: 12,
    textAlign: 'center',
    lineHeight: 24,
    overflow: 'hidden',
  },
  urlText: {
    ...Typography.body,
    flex: 1,
  },
  urlActions: {
    flexDirection: 'row',
    gap: 4,
  },
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.xs,
    gap: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    paddingTop: 4,
    marginTop: 4,
  },
  intervalLabel: {
    ...Typography.hint,
    color: Colors.textSecondary,
    fontSize: 11,
  },
  intervalInput: {
    width: 45,
    height: 24,
    backgroundColor: Colors.surface,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingHorizontal: 4,
    ...Typography.hint,
    fontSize: 12,
    textAlign: 'center',
    color: Colors.textPrimary,
  },
  intervalUnit: {
    ...Typography.hint,
    fontSize: 11,
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.3,
  },
  actionButtonText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  deleteButton: {
    backgroundColor: Colors.errorLight,
  },
  deleteButtonText: {
    fontSize: 14,
    color: Colors.error,
    fontWeight: 'bold',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    backgroundColor: Colors.surfaceVariant,
    borderRadius: Spacing.inputRadius,
    marginBottom: Spacing.md,
  },
  emptyStateIcon: {
    fontSize: 32,
    marginBottom: Spacing.sm,
  },
  emptyStateText: {
    ...Typography.label,
    color: Colors.textSecondary,
  },
  emptyStateHint: {
    ...Typography.hint,
    marginTop: 4,
  },
  addSection: {
    gap: Spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    height: 48,
    backgroundColor: Colors.surface,
    borderRadius: Spacing.inputRadius,
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingHorizontal: Spacing.md,
    ...Typography.body,
    color: Colors.textPrimary,
  },
  addButton: {
    width: 48,
    height: 48,
    backgroundColor: Colors.primary,
    borderRadius: Spacing.inputRadius,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonDisabled: {
    backgroundColor: Colors.divider,
  },
  addButtonText: {
    fontSize: 24,
    color: Colors.textOnPrimary,
    fontWeight: 'bold',
  },
  countText: {
    ...Typography.hint,
    textAlign: 'right',
  },
});

export default UrlListEditor;
