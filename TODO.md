# TODO

This page describes small tasks that needs to be done, bigger features are described in docs/PRD/\*.md

Note to AI: When you finish a sub-task, mark it with a checkmark, and ignore future improvements it is to be defined further by human

- [x] (dashboard) creating a new panel should create the closest to current view instead of always below
- [ ] (explorer) for breadcrumb use daisy ui breadcrumb component
- [ ] (input-panel) Handle QOS and retains when sending messages with arrow that show a section to config that maybe
- [ ] (config-page) Configure tls connections with certificates for brokers
- [x] (panels) only move a panel by dragging the header not the content
- [x] (dark-mode) currently the app use system theme, and in light mode the app logo, log-panel date are not visible, the logo is svg so change to other color and log panel date too
- [x] (log-panel) when i click quickly on a button with topic test, some messages are showing in live ws but when i reload they are missing in history
- [x] (log-panel) when live streaming msg currently the log panels shows the timestamp for a message when the websocket receives it, it may not be the same as the real timestamp
- [x] (log-panel) handle correctly the change of date format between history and livestream, when i chnage already logged from livestream show the old date format + add a new format like full date without the full phrase like date hour
- [x] (log-panel) there is still issues with wildcard, i think the history is not properly fetched, ex: log-panel show test/tetsgisf/# and sending on test/tetsgisf will show in live log correctly but if i refresh i dont see messages from history, i also think we should add tests for this feature in front and in backend make them better
- [x] (explorer-picker) handle better log-panel topic picker, right now it changes the last item in comma separated topics and still show all items in explorer announcement bar
- [x] (explorer-picker) when going to explorer page, if the current selected topic exists it should open to it
- [x] (explorer-picker) i dont like the design of the search icon
- [x] (explorer-picker) the breadcrumb doesnt work with the picker
- [x] (explorer-picker) when i select another broker and select a topic from this other it doesnt change the broker in the edit modla
- [x] (dashboard) handle no brokers in select broker in panels modal
- [x] (dashboard) creating a new panel should scroll to it and temporarily highlight with blue
- [x] (connection-status) clicking a broker should redirect to the config page of the broker
- [x] (explorer-page) add breadcrumb in title of topic to navigate easier over the log panel
- [x] (log-panel) i think log panels doesnt handle well wildcards in topic input
- [x] (docker) make a production dockerfile that works using the embeded react build i did
- [x] (docker) how to handle the volume for the database
- [x] (release) add release-please to handle releasing + ci to verify pr uses conventional commits
- [x] (mqtt-stats) i want the Broker Information section in config to be next to the config form instead of below
- [x] (multi-broker)fix config page connecting stays on in form but it is shown as connected in top right status
- [x] (multi-broker)form in config page is not centered, redesign it
- [x] (multi-broker)when i come to config page it goes to the new broker form instead of editing the default one also it should have an empty state letting the user click the new broker button
- [x] (multi-broker)in the form to config broker, the broker name should be editable by clicking the New Broker title instead of having another form line
- [x] (multi-broker)the edit modal in dashboard panel shows a --select broker-- item i dont want it, panel that have this selected should have the defautl one
- [x] (multi-broker)when i let the default new broker title it tells me name is required, i want to save it as New Broker
- [x] (explorer-page)when i go to dashboard and add a button to send a message test to a topic test in mosquitto broker, i cant see anything it in explorer page (fixed in 68d4df0db4df237abaeb5127ce8830c094e8ca53)
- [x] (explorer-page)in config page, there should be a second navbar, with brokers section, and general section with the data retention form
- [x] (explorer-page)the log panels in dashboard should access the history to show previous messages (greyed out)
- [x] (explorer-page)there are backend status checks that are wrong, sometimes i dont see loading state but i can see that the frontend has not access to the backend yet (the dashboard not loaded but i see the add panel empty state)
- [x] (explorer-page)for the StartPruningJob that cleans history, i think it should be run at the start and end of the app in case it crashes out
- [x] (explorer-page)the line should collapse/expand when i click the left part of line where the arrow is instead of the whole line
- [x] (technical-debts)improve logging using the stdlib slog library
- [x] (technical-debts)remove logging for status path
- [x] (technical-debts)add testing for handlers, db operations, cron, websockets and mqtt management, also try to ensure 70% code coverage
- [x] (mqtt-stats)MQTT-explorer shows those infos for the current broker (probably fropm $SYS), i want to show the same somewhere (maybe config page) like broker name and version, sent received messages, clients and subscriptions, sent 5m received 5m, memory and memory max
- [x] (mqtt-stats)also in explorer page it should show the $SYS topic but add a toggle to hide it
- [x] (mqtt-stats)right now the placeholder feature to show $sys topics before messages are coming is not working properly, i think the front is waiting for the config show $sys in db before showing it which makes the explorer shows existing topic with history before the $sys placeholder
- [x] (mqtt-stats)the log panel show duplicates messages only for the $sys topics
- [x] (mqtt-stats)i need to add tests to fix code coverage (still at 66.2%)
- [x] (mqtt-stats)now the issue is that when i click a topic i dont see anything on some topics and sometimes i see messages but they are still duplicated
