# Changelog

## [1.9.0](https://github.com/jmischler72/mqtt-dashboard/compare/v1.8.0...v1.9.0) (2026-08-20)


### Features

* **config:** add initial brokers seeding from config file and dev environment setup ([#116](https://github.com/jmischler72/mqtt-dashboard/issues/116)) ([fdea283](https://github.com/jmischler72/mqtt-dashboard/commit/fdea2837b7b209d51d5f12a1a32264ff6fef81bc))
* **config:** fix client cert layout, unify topic selector & handle wildcard warnings ([#109](https://github.com/jmischler72/mqtt-dashboard/issues/109)) ([f22186f](https://github.com/jmischler72/mqtt-dashboard/commit/f22186f76c66da928433cd4f49ddffaf05a1ddad))
* **gauge:** implement gauge panel type for numbers, booleans, and strings ([#114](https://github.com/jmischler72/mqtt-dashboard/issues/114)) ([2858763](https://github.com/jmischler72/mqtt-dashboard/commit/2858763dddbe867f0dda25bce4b1e7d1eea1a9ed))


### Bug Fixes

* **dashboard:** better starter templates and dev worktree info in credits ([#118](https://github.com/jmischler72/mqtt-dashboard/issues/118)) ([6ce4978](https://github.com/jmischler72/mqtt-dashboard/commit/6ce49788e2145c591f187cb00784b69f943f9502))
* **dashboard:** refine dashboard panel UI logic and wildcard validation ([#117](https://github.com/jmischler72/mqtt-dashboard/issues/117)) ([ba22479](https://github.com/jmischler72/mqtt-dashboard/commit/ba22479ec8d365afafb77c7c101afe3293433e33))

## [1.8.0](https://github.com/jmischler72/mqtt-dashboard/compare/v1.7.2...v1.8.0) (2026-08-16)


### Features

* **button-panel:** add option to add confirm dialog before sending message ([#92](https://github.com/jmischler72/mqtt-dashboard/issues/92)) ([#106](https://github.com/jmischler72/mqtt-dashboard/issues/106)) ([04a91d3](https://github.com/jmischler72/mqtt-dashboard/commit/04a91d3bd835be9495bcc248dade6c87c0afd2ab))
* **dashboard:** add import/export of dashboards with json files ([#91](https://github.com/jmischler72/mqtt-dashboard/issues/91)) ([12b326f](https://github.com/jmischler72/mqtt-dashboard/commit/12b326fb12b7d40b0453962305fd5d7d41d10d9b))

## [1.7.2](https://github.com/jmischler72/mqtt-dashboard/compare/v1.7.1...v1.7.2) (2026-07-22)


### Bug Fixes

* **cron:** add expression validation and improve UI feedback ([#89](https://github.com/jmischler72/mqtt-dashboard/issues/89)) ([ae83d29](https://github.com/jmischler72/mqtt-dashboard/commit/ae83d29effbabf94cdd69c6d4e128cc476b3784e))

## [1.7.1](https://github.com/jmischler72/mqtt-dashboard/compare/v1.7.0...v1.7.1) (2026-07-16)


### Bug Fixes

* **tabs:** use correctly daisyui tabs + fix deps ([#85](https://github.com/jmischler72/mqtt-dashboard/issues/85)) ([0c5914f](https://github.com/jmischler72/mqtt-dashboard/commit/0c5914f7ee3c20a3ebaef6eeed8d00094cacce91))

## [1.7.0](https://github.com/jmischler72/mqtt-dashboard/compare/v1.6.0...v1.7.0) (2026-07-16)


### Features

* **responsive:** implement mobile navigation and layout adjustments ([#84](https://github.com/jmischler72/mqtt-dashboard/issues/84)) ([0936ab8](https://github.com/jmischler72/mqtt-dashboard/commit/0936ab8b4529f1da5398c6415b91074e2944c635))


### Bug Fixes

* **layout:** adjust panel dimensions for separator type in CreatePanel method ([#79](https://github.com/jmischler72/mqtt-dashboard/issues/79)) ([755f76d](https://github.com/jmischler72/mqtt-dashboard/commit/755f76d1ab49b480d08b8d4af0a3031e4c9a12a0))
* **panel:** better style for image and text panels edit modal ([#83](https://github.com/jmischler72/mqtt-dashboard/issues/83)) ([fc6da5b](https://github.com/jmischler72/mqtt-dashboard/commit/fc6da5bde3bb48eb3277235fe05fef8d3adf4e41))

## [1.6.0](https://github.com/jmischler72/mqtt-dashboard/compare/v1.5.0...v1.6.0) (2026-06-12)


### Features

* **explorer:** expand/collapse all, wildcard root node, default collapsed tree ([#66](https://github.com/jmischler72/mqtt-dashboard/issues/66)) ([2109beb](https://github.com/jmischler72/mqtt-dashboard/commit/2109bebc74e0b7e1fa068dc11aa68125b72c55d8))


### Bug Fixes

* **panel:** align payload popover position to the right of the label ([#65](https://github.com/jmischler72/mqtt-dashboard/issues/65)) ([6a7fa98](https://github.com/jmischler72/mqtt-dashboard/commit/6a7fa98f7be4db8de6a64b72a389170848c9ce9a))

## [1.5.0](https://github.com/jmischler72/mqtt-dashboard/compare/v1.4.0...v1.5.0) (2026-06-12)


### Features

* **dependabot:** enhance React update grouping with additional patterns for types and dev-deps ([#60](https://github.com/jmischler72/mqtt-dashboard/issues/60)) ([46b2718](https://github.com/jmischler72/mqtt-dashboard/commit/46b2718a6456a0c5be719202a3deaf202103f0e0))
* **mqtt:** store qos/retain flags in db + show badges in log panels ([#58](https://github.com/jmischler72/mqtt-dashboard/issues/58)) ([5e419b7](https://github.com/jmischler72/mqtt-dashboard/commit/5e419b7eb86b2995386f2c4116797c38aa272978))


### Bug Fixes

* **mqtt:** improve mutex handling in Connect and Subscribe methods ([#64](https://github.com/jmischler72/mqtt-dashboard/issues/64)) ([6f5c3de](https://github.com/jmischler72/mqtt-dashboard/commit/6f5c3defcf12423026d6d71394a5a9e64caf3d1e))

## [1.4.0](https://github.com/jmischler72/mqtt-dashboard/compare/v1.3.0...v1.4.0) (2026-06-11)


### Features

* **panels:** add visual panels + preview ([#55](https://github.com/jmischler72/mqtt-dashboard/issues/55)) ([eccdd4d](https://github.com/jmischler72/mqtt-dashboard/commit/eccdd4d6bc0b24ddf5555229379454ef896be6d4))

## [1.3.0](https://github.com/jmischler72/mqtt-dashboard/compare/v1.2.0...v1.3.0) (2026-06-09)


### Features

* **explorer:** add cumulative show toggle for parent topic messages ([#52](https://github.com/jmischler72/mqtt-dashboard/issues/52)) ([da9898e](https://github.com/jmischler72/mqtt-dashboard/commit/da9898e475766e9bde506dc45e6923d6cba51724))
* **panels:** add a new stats panel for topics ([#53](https://github.com/jmischler72/mqtt-dashboard/issues/53)) ([32beeef](https://github.com/jmischler72/mqtt-dashboard/commit/32beeef3a53961c560c15a393e84d7badd6087e5))


### Bug Fixes

* **CronPanel:** adjust width styling for countdown display ([#51](https://github.com/jmischler72/mqtt-dashboard/issues/51)) ([aa616d6](https://github.com/jmischler72/mqtt-dashboard/commit/aa616d656de8b5cd2eb34ad177a2ddb0dcc23fb4))
* **panel:** correct hover popovers for topic summary and payload preview ([#48](https://github.com/jmischler72/mqtt-dashboard/issues/48)) ([ac374d3](https://github.com/jmischler72/mqtt-dashboard/commit/ac374d3334f7e203a46f013ac9b2c51de9acc0a9))
* **sys_topics:** rename show_sys_topics to save_sys_topics and update show sys topic in explorer ([#50](https://github.com/jmischler72/mqtt-dashboard/issues/50)) ([719a808](https://github.com/jmischler72/mqtt-dashboard/commit/719a8085dd606f83f81b51281b2f35ab054be8f6))

## [1.2.0](https://github.com/jmischler72/mqtt-dashboard/compare/v1.1.3...v1.2.0) (2026-06-09)


### Features

* **config:** show and clear MQTT history size ([#47](https://github.com/jmischler72/mqtt-dashboard/issues/47)) ([66d4502](https://github.com/jmischler72/mqtt-dashboard/commit/66d4502e855944f2b7b4749da748f81163985c42))
* **panel:** add arrow icon for meta popover toggle in PanelWrapper ([#39](https://github.com/jmischler72/mqtt-dashboard/issues/39)) ([7c46312](https://github.com/jmischler72/mqtt-dashboard/commit/7c463129b0f61eb78dcc0b082d5e6b137d2e11d2))
* **panels:** add pinable sub-header that shows infos about panel + redesign cron/input panels  ([#37](https://github.com/jmischler72/mqtt-dashboard/issues/37)) ([392a7c3](https://github.com/jmischler72/mqtt-dashboard/commit/392a7c33f25b7640cf86aad43c507ee832f809c6))


### Bug Fixes

* **panel:** prevent event propagation on title input mouse down in PanelWrapper ([#46](https://github.com/jmischler72/mqtt-dashboard/issues/46)) ([47468e9](https://github.com/jmischler72/mqtt-dashboard/commit/47468e97effc875ea2c4261e245af87cee6802c6))
* **registry:** update MQTT message topics for 5-minute stats in registry.go ([#45](https://github.com/jmischler72/mqtt-dashboard/issues/45)) ([fb1bd3d](https://github.com/jmischler72/mqtt-dashboard/commit/fb1bd3ddd28ee0f8e89a6ecdf1bcb1b49fc3a3e1))
* **ws:** fix websocket connection origin check in production docker compose ([#44](https://github.com/jmischler72/mqtt-dashboard/issues/44)) ([00d2d93](https://github.com/jmischler72/mqtt-dashboard/commit/00d2d9386d7bf968b5e7f5a98afadfb54f86b39e))

## [1.1.3](https://github.com/jmischler72/mqtt-dashboard/compare/v1.1.2...v1.1.3) (2026-05-28)


### Bug Fixes

* **build:** push package to arm arch for raspi ([#29](https://github.com/jmischler72/mqtt-dashboard/issues/29)) ([5c393b1](https://github.com/jmischler72/mqtt-dashboard/commit/5c393b10c19aaafb52fdb1737387154e1620f0f1))

## [1.1.2](https://github.com/jmischler72/mqtt-dashboard/compare/v1.1.1...v1.1.2) (2026-05-23)


### Bug Fixes

* **deps:** update GitHub Actions to latest ver + create release ([040286b](https://github.com/jmischler72/mqtt-dashboard/commit/040286b403b10d43aef1c1b876bb27fc416edb1d))

## [1.1.1](https://github.com/jmischler72/mqtt-dashboard/compare/v1.1.0...v1.1.1) (2026-05-23)


### Bug Fixes

* **dev:** title + dev issues ([fef0291](https://github.com/jmischler72/mqtt-dashboard/commit/fef0291c6a450f1136e1aaffb20ae57004b519b2))
* **security:** run Dockerfile with appuser permissions and add dependabot configuration ([02b0291](https://github.com/jmischler72/mqtt-dashboard/commit/02b029132c81126042f17d393f2fa6e406be375d))

## [1.1.0](https://github.com/jmischler72/mqtt-dashboard/compare/v1.0.0...v1.1.0) (2026-05-23)


### Features

* **broker:** implement TLS and authentication options for MQTT brokers ([#10](https://github.com/jmischler72/mqtt-dashboard/issues/10)) ([24fe4fa](https://github.com/jmischler72/mqtt-dashboard/commit/24fe4fa96a45989ce78d666784f88ce8182fc05e))
* **explorer:** enhance topic with breadcrumb clickable path segments ([c251842](https://github.com/jmischler72/mqtt-dashboard/commit/c2518427a00ca19cfc3473f1ab969518b9a8937f))
* **explorer:** implement topic picker ([#7](https://github.com/jmischler72/mqtt-dashboard/issues/7)) ([0171192](https://github.com/jmischler72/mqtt-dashboard/commit/0171192ab73003d54fd7e6c67a15ab94cd8af26d))
* **mqtt:** add QoS and retain options for message publishing ([#9](https://github.com/jmischler72/mqtt-dashboard/issues/9)) ([a6ec1fe](https://github.com/jmischler72/mqtt-dashboard/commit/a6ec1fe7c7ae975c909a381143602aada42322a4))
* **navbar:** redirect to config on broker click ([807c274](https://github.com/jmischler72/mqtt-dashboard/commit/807c2744a55d2878d5fa2a5a2291945ecd9401bb))
* **panel:** add position parameters for panel creation and auto-positioning logic ([1899efd](https://github.com/jmischler72/mqtt-dashboard/commit/1899efde8411008db00d89805186bb7c89b39e8c))
* **panels:** scroll on new panel + empty state config when no brokers ([d4e4258](https://github.com/jmischler72/mqtt-dashboard/commit/d4e42581ac535a6a40357d55f3e4983d2a09d7ad))


### Bug Fixes

* **backend:** history storing using worker to handle quick topic sent ([#8](https://github.com/jmischler72/mqtt-dashboard/issues/8)) ([f2367c0](https://github.com/jmischler72/mqtt-dashboard/commit/f2367c00bc949b4b0f4495dc70a912f8b5f59347))
* **db:** serialize DB access to prevent SQLITE_BUSY errors and optimize concurrent access ([70463cc](https://github.com/jmischler72/mqtt-dashboard/commit/70463ccff66e107073d0b13f6e57040ecf19c809))
* **panel:** prevent dragging of panel content by blocking drag events on body ([e297772](https://github.com/jmischler72/mqtt-dashboard/commit/e29777220c52c6a2ef90e8495c32b14ac523f0d6))
* **subscribe:** implement correctly wildcard support for topic filtering ([4386ebb](https://github.com/jmischler72/mqtt-dashboard/commit/4386ebb46bd952f33897130c07b7b887ce154728))

## 1.0.0 (2026-05-20)


### Features

* Add CI workflows for backend and frontend with testing and build steps ([f9eae74](https://github.com/jmischler72/mqtt-dashboard/commit/f9eae742aa5f01f2ee2ec61e0d7be447b970c745))
* add credits modal to Layout component and update logo dimensions ([f34b7b0](https://github.com/jmischler72/mqtt-dashboard/commit/f34b7b031b2f0d3dc902610a7b828b1c9fa889df))
* add logging configuration to mosquitto ([030dc7a](https://github.com/jmischler72/mqtt-dashboard/commit/030dc7abe604cab9c9fe1a0c3c5e6590fb711d9c))
* add StatsCache for MQTT broker statistics and BrokerInfoPanel c… ([#3](https://github.com/jmischler72/mqtt-dashboard/issues/3)) ([6d6fa04](https://github.com/jmischler72/mqtt-dashboard/commit/6d6fa0418440cdacc9e81f4a08a1b525a17aa46b))
* add TODO for multi-broker feature improvements ([864ca24](https://github.com/jmischler72/mqtt-dashboard/commit/864ca246ec37b89f9dd780b79b3d540762bdd97c))
* Add unit tests for MQTT handlers, settings, and WebSocket funct… ([73c82b0](https://github.com/jmischler72/mqtt-dashboard/commit/73c82b065e45d7416f740246d56e68e9d7879114))
* Add unit tests for MQTT handlers, settings, and WebSocket functionality ([e694e04](https://github.com/jmischler72/mqtt-dashboard/commit/e694e04eb5ab14fc95d0f203640bcc782f2c398d))
* **dashboard:** enhance panel drag-and-drop functionality with static layout in edit mode ([c9c687d](https://github.com/jmischler72/mqtt-dashboard/commit/c9c687d6002b298ed62a41d856bcf6b8f2a7ba87))
* **dashboard:** implement dashboard management with create, rename, and delete functionalities ([4594fa8](https://github.com/jmischler72/mqtt-dashboard/commit/4594fa870c8103085dabe0044ea9ce8bb0345bba))
* **dashboard:** implement edit mode toggle and integrate with layout context ([a758c80](https://github.com/jmischler72/mqtt-dashboard/commit/a758c80240c33eabe00596b5a86e9dd874e47fe2))
* **dashboard:** improve loading state handling and UI feedback ([9b56cce](https://github.com/jmischler72/mqtt-dashboard/commit/9b56cce0da8c265ed47922a407cde08c6e3701cf))
* enhance modal box styling and improve log panel auto-scroll functionality ([63f7cd5](https://github.com/jmischler72/mqtt-dashboard/commit/63f7cd52185022fb2fc9daf93e5e6717010ac6bf))
* **explorer:** add Product Requirement Document for MQTT Topic Explorer & History Tracking ([1156663](https://github.com/jmischler72/mqtt-dashboard/commit/1156663ca42ba9171f222ff2c8aadff5a85f85b9))
* implement data retention settings and explorer functionality; add pruning job for mqtt_history ([cfbdd89](https://github.com/jmischler72/mqtt-dashboard/commit/cfbdd89ba4d2ba6db822e6c7c5b3b53057973082))
* implement multi-broker support with UI updates and backend registry ([662e068](https://github.com/jmischler72/mqtt-dashboard/commit/662e068322324a04ed5c26e5421cf1ae5af786bf))
* **layout:** conditionally render dashboard controls based on current route ([28f2125](https://github.com/jmischler72/mqtt-dashboard/commit/28f21250c268cd787ed10a9b6353ed0b6721fa71))
* **log-panel:** add date format selection to log configuration modal ([a736621](https://github.com/jmischler72/mqtt-dashboard/commit/a7366219883541203b681b0917e69c3be767f405))
* **panel:** update minimum height for panels + fix editing modal ([73850e3](https://github.com/jmischler72/mqtt-dashboard/commit/73850e39396c25cbd6398b2603eb9ac604cece79))
* **release:** add prod Dockerfile + release resource for release-please ([#4](https://github.com/jmischler72/mqtt-dashboard/issues/4)) ([a0af6b4](https://github.com/jmischler72/mqtt-dashboard/commit/a0af6b4c2294e30680c1c84733f519a49f3d26ff))
* update favicon and logo SVG files; add new Ideas.md for future enhancements ([825ea27](https://github.com/jmischler72/mqtt-dashboard/commit/825ea27c0dfafe1b9ba067490385fba677f3b203))
* update TODO for multi-broker feature improvements and design adjustments ([a475ca0](https://github.com/jmischler72/mqtt-dashboard/commit/a475ca0f8b3a8c32195e8c013b0aae9145139dbe))


### Bug Fixes

* add panel button not working ([6d67325](https://github.com/jmischler72/mqtt-dashboard/commit/6d67325b8894c79531333185f66cea6e9c8fe8f3))
* **backend:** add test to get above 70 percent code coverage ([574da96](https://github.com/jmischler72/mqtt-dashboard/commit/574da96d57ea36f251d12a25dbafb8f833be5381))
* better loading state + log panel self fetch history + config page layout ([c5a05e5](https://github.com/jmischler72/mqtt-dashboard/commit/c5a05e5bada8b56754876b7a691b47c34d09e559))
* **build:** some build issue and prettier config ([6fd8b59](https://github.com/jmischler72/mqtt-dashboard/commit/6fd8b59f85451b5542e67167f004e389632a7ddf))
* config page default broker name ([cb333b8](https://github.com/jmischler72/mqtt-dashboard/commit/cb333b8bcdf4dbf9e886f08e7400b040c649b3c5))
* enhance MQTTManager with separate live and history harvesters; update ExplorerPage and LogPanel for improved message handling ([82bff9a](https://github.com/jmischler72/mqtt-dashboard/commit/82bff9a22cb48d93a06251ad2549d5a054e8d439))
* ensure prunehistory job starts immediately ([d33436d](https://github.com/jmischler72/mqtt-dashboard/commit/d33436dae5445d6ac55f7b093be9e6aaa532d54f))
* **explorer:** collapse node tree only by clicking the arrow ([0796ece](https://github.com/jmischler72/mqtt-dashboard/commit/0796ece828a007fc84314a86c4cf93bb75a1545c))
* **lint:** fix all errors ([076c102](https://github.com/jmischler72/mqtt-dashboard/commit/076c1027e29a2656c76dd103157d171582557a46))
* **log-panel:** duplicate msg because of react strictmode ([2aa498c](https://github.com/jmischler72/mqtt-dashboard/commit/2aa498cedfd64d37aed6c2a8a72e98b8122f265f))
* **panel:** dont drag and resize when modal is opened ([095c3cf](https://github.com/jmischler72/mqtt-dashboard/commit/095c3cf7d770202a580fc4330a837592e41a80c5))
* **panel:** improve panel visibility logic when editing ([8eca07b](https://github.com/jmischler72/mqtt-dashboard/commit/8eca07bc3ec8e8afc75545b80cd356fee0179ba5))
* some multi-broker feedbacks ([448609c](https://github.com/jmischler72/mqtt-dashboard/commit/448609ce737a5d0ac834ce56ce416eeb7d44201f))
* update config link text to 'Configuration' ([9184ad7](https://github.com/jmischler72/mqtt-dashboard/commit/9184ad78c0a43b55f891ef6ef59f43f77b6035e0))
* **workflows:** remove push triggers from backend and frontend CI configurations ([891c821](https://github.com/jmischler72/mqtt-dashboard/commit/891c8219248c3edcbb8b705c07c8c9fb74ab3490))
* **ws:** fix duplicate msg when # and topic subscriptions are made + cleanup wrong fix of registry ([68d4df0](https://github.com/jmischler72/mqtt-dashboard/commit/68d4df0db4df237abaeb5127ce8830c094e8ca53))


### Code Refactoring

* migrate logging to the slog library for improved consistency and structure + chi middleware skip log for status poll ([3c51073](https://github.com/jmischler72/mqtt-dashboard/commit/3c51073d9bb7ec2e176c7b10ce951d4ea98c7f7d))
* update form structure to use fieldsets for better accessibility and styling ([4d77831](https://github.com/jmischler72/mqtt-dashboard/commit/4d77831d23e45c36ded50534a9d7540769ea7f9c))
