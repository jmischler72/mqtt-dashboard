# Product Requirement Document (PRD)

## Feature: Advanced Cross-Page Topic Picker Workflow

### 1. Document Control

* **Status:** Ready for Development
* **Author:** Product Management / Engineering Lead
* **Target Release:** Sprint Cycles

---

### 2. Feature Overview & Problem Statement

Users currently have to manually type or copy-paste MQTT/event topics into the configuration input field of various dashboard panels. This is error-prone and inefficient.

This feature introduces a **Topic Picker Workflow** that bridges the Panel Configuration Modal and the Explorer page. It allows users to temporarily context-switch to the Explorer page, seamlessly filters data based on their panel's existing broker configuration, stage a selection via a sticky announcement bar, and return to their modal with zero loss of draft state.

---

### 3. User Experience & User Flows

#### Flow A: Core Selection Journey

1. User opens a panel configuration modal and clicks the **Quick Pick** icon button next to the Topic input.
2. User is redirected to the Explorer page. The page recognizes "Picker Mode," preserves panel context, and sets the Broker filter automatically.
3. User clicks an available topic from the Explorer tree/list. The selection is staged in a top Announcement Bar.
4. User clicks **"Confirm & Return"** in the Announcement Bar.
5. User is routed back to the open Panel Config Modal with the selected topic pre-filled.

#### Flow B: Cancel / Exit Journey

* At step 3 or 4 above, the user clicks **"Cancel Picker"** in the Announcement Bar.
* The system strips the picker parameters from the URL, hides the Announcement Bar, and leaves the user on the native Explorer page without losing their current view.

---

### 4. Functional Requirements

#### 4.1 Panel Config Modal Integration

* **UI Element:** Append a secondary action button (e.g., `ListBulletIcon` or `CompassIcon`) directly inside or to the right of the `Topic` text input field.
* **State Preserving Navigation:** On click, trigger navigation to `/explorer` containing the following state payload (via URL Query Params or Router State):
* `mode=picker` (Activates picker layout)
* `brokerId=[current_panel_broker]` (Passes the active panel context)
* `returnUrl=[current_dashboard_url]` (Tells the app how to route back)
* `panelId=[current_panel_id]` (Identifies the panel being edited)
* `currentTopic=[current_input_value]` (Preserves any text already typed)



#### 4.2 Explorer Page Requirements (Picker Mode)

* **Filter Synchronization:** On initialization, if `mode=picker` and a `brokerId` parameter exist, the Explorer’s Navbar **Broker Selector** dropdown must automatically lock/set to match the passed `brokerId`.
* **Row Interception:**
* Standard click navigation on topic links/cards must be intercepted.
* Single-clicking a topic row must highlight the item and update the staged selection state in the Announcement Bar.
* *(Optional Quality of Life)*: Double-clicking a topic row triggers the immediate Confirmation & Return event.



#### 4.3 Announcement Bar Component

When `mode=picker` is active, inject a sticky, high-contrast Announcement Bar at the absolute top of the viewport (shifting the main content layout down).

```
+-----------------------------------------------------------------------------------------+
| ⚠️ Picker Mode | Selected: [topic/path/staged]          [Confirm & Return]  [Cancel]   |
+-----------------------------------------------------------------------------------------+

```

* **Dynamic States & Behaviors:**
1. **Empty State (No topic selected yet):**
* Display Text: `"Picker Mode: Select a topic from the list below"`
* Primary Button Text: `"Return to Panel"`
* Action: Clicking returns the user to the panel config modal keeping the `currentTopic` completely unchanged.


2. **Staged State (Topic clicked):**
* Display Text: `"Picker Mode | Selected: {staged_topic_path}"`
* Primary Button Text: `"Confirm & Return"`
* Action: Returns the user to the panel config modal, overwriting/injecting the `staged_topic_path` into the input field.


3. **Cancel Button Behavior:**
* Text: `"Cancel"`
* Action: Exits Picker Mode entirely. Strips query params from the URL bar, unmounts the Announcement Bar, and converts row clicks back to standard Explorer functionality.





---

### 5. Technical Architecture & State Notes

> ⚠️ **Critical Risk Warning:** Navigating away from the dashboard route can destroy the unsaved configuration state of the entire panel modal.

#### Recommended State Retention Strategy

To prevent losing other fields modified in the panel config prior to picking a topic, engineering must implement one of the following mechanisms:

| Method | Implementation | Pros/Cons |
| --- | --- | --- |
| **Option A (URL / Router State)** | Pass the entire unsaved panel form payload as serialized data to the Explorer page and bounce it right back on return. | + Stateless, robust to refreshes.<br>

<br>- Heavy URL parameters if form is complex. |
| **Option B (Global Context / UI Store)** | Store the `activePanelDraftState` in an ephemeral global memory cache (Zustand, Redux, Pinia) while `mode=picker` is true. | + Clean URLs, simple execution.<br>

<br>- Cache resets if user performs a hard refresh (F5). |

---

### 6. Acceptance Criteria (Definition of Done)

* [ ] The picker icon button displays correctly aligned next to the panel topic field.
* [ ] Clicking the button accurately carries the panel's selected broker over to the Explorer page view.
* [ ] The Announcement Bar accurately renders at the top of the screen only when query string parameters validate picker conditions.
* [ ] Clicking topics updates the bar's real-time label rather than triggering native route redirections.
* [ ] Clicking "Confirm & Return" brings the user smoothly back into the active panel edit viewport with the text input successfully updated.
* [ ] Clicking "Cancel" cleanly shuts off picker utilities without kicking the user away from their current scrolled position on the Explorer.