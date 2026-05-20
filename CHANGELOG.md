# Changelog

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
