/**
 * FreeKiosk - CrashLogSection
 * Shows the last crashes recorded on the device (native + JS), so an unattended
 * kiosk that "just closed" can be diagnosed without a PC and adb logcat.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Alert,
  Share,
} from 'react-native';
import { Colors, Spacing, Typography } from '../../theme';
import Icon from '../Icon';
import { readCrashLog, clearCrashLog } from '../../utils/CrashLog';

const CrashLogSection: React.FC = () => {
  const [log, setLog] = useState<string>('');
  const [showModal, setShowModal] = useState(false);

  const loadLog = useCallback(async () => {
    setLog(await readCrashLog());
  }, []);

  useEffect(() => {
    loadLog();
  }, [loadLog]);

  const handleOpen = async () => {
    await loadLog();
    setShowModal(true);
  };

  const handleShare = async () => {
    try {
      await Share.share({ message: log, title: 'FreeKiosk crash log' });
    } catch (error) {
      Alert.alert('Error', `Unable to share the log: ${String(error)}`);
    }
  };

  const handleClear = () => {
    Alert.alert('Clear Crash Log', 'Delete all recorded crashes?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearCrashLog();
          setLog('');
          setShowModal(false);
        },
      },
    ]);
  };

  const hasLog = log.trim().length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Icon name="alert-circle-outline" size={20} color={Colors.textSecondary} />
        <Text style={styles.headerTitle}>Crash Log</Text>
      </View>

      <Text style={styles.description}>
        {hasLog
          ? 'The app closed unexpectedly at least once. Open the log to see why, or share it with support.'
          : 'No crash recorded. If the app closes unexpectedly, the reason will appear here.'}
      </Text>

      <TouchableOpacity
        style={[styles.actionButton, !hasLog && styles.actionButtonDisabled]}
        onPress={handleOpen}
        disabled={!hasLog}
      >
        <Icon name="file-document-outline" size={18} color={Colors.textOnPrimary} />
        <Text style={styles.actionButtonText}>View Crash Log</Text>
      </TouchableOpacity>

      <Modal visible={showModal} animationType="slide" onRequestClose={() => setShowModal(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>💥 Crash Log</Text>
            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setShowModal(false)}>
              <Text style={styles.modalCloseButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.logScroll} contentContainerStyle={styles.logContent}>
            <Text style={styles.logText} selectable>
              {log}
            </Text>
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity style={[styles.footerButton, styles.shareButton]} onPress={handleShare}>
              <Text style={styles.footerButtonText}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.footerButton, styles.clearButton]} onPress={handleClear}>
              <Text style={styles.footerButtonText}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.cardDefault,
    borderRadius: Spacing.cardRadius,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  headerTitle: {
    ...Typography.label,
    marginLeft: Spacing.sm,
    color: Colors.textPrimary,
  },
  description: {
    ...Typography.hint,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    borderRadius: Spacing.buttonRadius,
    backgroundColor: Colors.primary,
    gap: Spacing.xs,
  },
  actionButtonDisabled: {
    backgroundColor: Colors.textDisabled,
  },
  actionButtonText: {
    ...Typography.buttonSmall,
    color: Colors.textOnPrimary,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    ...Typography.sectionTitle,
    color: Colors.textPrimary,
  },
  modalCloseButton: {
    padding: Spacing.sm,
  },
  modalCloseButtonText: {
    fontSize: 24,
    color: Colors.textSecondary,
  },
  logScroll: {
    flex: 1,
  },
  logContent: {
    padding: Spacing.md,
  },
  logText: {
    color: Colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 11,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  footerButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Spacing.buttonRadius,
  },
  shareButton: {
    backgroundColor: Colors.primary,
  },
  clearButton: {
    backgroundColor: Colors.error,
  },
  footerButtonText: {
    ...Typography.buttonSmall,
    color: Colors.textOnPrimary,
  },
});

export default CrashLogSection;
