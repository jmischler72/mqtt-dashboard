# TODO
Note to AI: When you finish a sub-task, mark it with a checkmark

## Multi-Broker Feature
- ✅ fix config page connecting stays on in form but it is shown as connected in top right status
- ✅ form in config page is not centered, redesign it
- ✅ when i come to config page it goes to the new broker form instead of editing the default one also it should have an empty state letting the user click the new broker button
- ✅ in the form to config broker, the broker name should be editable by clicking the New Broker title instead of having another form line
- ✅ the edit modal in dashboard panel shows a --select broker-- item i dont want it, panel that have this selected should have the defautl one
- ✅ when i let the default new broker title it tells me name is required, i want to save it as New Broker

## Explorer page
- ✅ when i go to dashboard and add a button to send a message test to a topic test in mosquitto broker, i cant see anything it in explorer page (fixed in 68d4df0db4df237abaeb5127ce8830c094e8ca53)
- in config page, there should be a second navbar, with brokers section, and general section with the data retention form
- the log panels should access the history to show previous messages (greyed out)
- there are backend status checks that are wrong, sometimes i dont see loading state but i can see that the frontend has not access to the backend yet

## Future improvements
- panels as plugins
    - func specs: Allow users to create custom panels and share them, the app should let users give a github link to a plugin and the app would get the panel so its usable, it should be managed by a sub page in configuration
    - tech specs: We could provide a template in this repo with a make script like make create-plugin <name> <path-to-plugin> that would copy it and change the name (in readme and others)
    The template would contain a plugin.tsx with a boilerplate for a panel along with its editing modal, a templated readme 
    The user can then edit a plugin.tsx to add whatever they want and just push to github
    In the app, when you then add plugin from github it will build the react component and dynamically add to the frontend, the backend can already handle custom config from json, we would just need to handle conflicts from same name panel-type
- Export dashboard as sharable file (maybe json)
- More broker infos
    - MQTT explorer shows those infos for the current broker (probably fropm $SYS), i want to show the same somewhere (maybe config page) like broker name, sent received messages, clients and subscriptions, sent 5m received 5m, memory and memory max
- Handle QOS things mqtt and retains ..
- Handle tls connections with certs