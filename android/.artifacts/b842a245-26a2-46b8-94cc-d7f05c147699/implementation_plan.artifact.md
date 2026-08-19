# Optional Duration for URL Rotation

Add an optional field for the duration each URL stays on the screen in the URL Rotation feature. If not provided, the default Rotation Interval will be used.

## Proposed Changes

### [Component: Types]

#### [NEW] [rotation.ts](file:///C:/Users/felip/StudioProjects/freekiosk/src/types/rotation.ts)
Define the `RotationUrl` interface to support optional intervals.

### [Component: Storage]

#### [MODIFY] [storage.ts](file:///C:/Users/felip/StudioProjects/freekiosk/src/utils/storage.ts)
Update `saveUrlRotationList` and `getUrlRotationList` to support the `RotationUrl` type. Ensure backward compatibility by handling string-only lists.

### [Component: UI]

#### [MODIFY] [UrlListEditor.tsx](file:///C:/Users/felip/StudioProjects/freekiosk/src/components/settings/UrlListEditor.tsx)
- Add `rotationMode` and `defaultInterval` props.
- Display an interval input for each URL when `rotationMode` is enabled.
- Allow users to set a specific interval (in seconds) for each URL.

#### [MODIFY] [GeneralTab.tsx](file:///C:/Users/felip/StudioProjects/freekiosk/src/screens/settings/tabs/GeneralTab.tsx)
- Update state and handlers to work with the `RotationUrl[]` type.
- Pass necessary props to `UrlListEditor`.

### [Component: Core Logic]

#### [MODIFY] [KioskScreen.tsx](file:///C:/Users/felip/StudioProjects/freekiosk/src/screens/KioskScreen.tsx)
- Update rotation effect to use `setTimeout` instead of `setInterval`.
- Dynamically calculate the delay for the next URL based on its individual interval or the default one.
- Update status reporting to include the new URL structure.

### [Component: Native Modules]

#### [MODIFY] [HttpServerModule.kt](file:///C:/Users/felip/StudioProjects/freekiosk/android/app/src/main/java/com/freekiosk/api/HttpServerModule.kt)
#### [MODIFY] [MqttModule.kt](file:///C:/Users/felip/StudioProjects/freekiosk/android/app/src/main/java/com/freekiosk/mqtt/MqttModule.kt)
Update `updateStatus` to safely parse the `rotationUrls` array, supporting both strings and objects.

## Verification Plan

### Automated Tests
- N/A (UI and integration focus)

### Manual Verification
1.  Enable URL Rotation in Settings.
2.  Add multiple URLs.
3.  Set a specific interval for one URL and leave others empty.
4.  Verify that the URL with a specific interval stays for that duration.
5.  Verify that other URLs use the default Rotation Interval.
6.  Check that MQTT and HTTP API status reports still show the correct URLs.
