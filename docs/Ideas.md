# Future ideas

## Panels as plugins

### Func specs

Allow users to create custom panels and share them, the app should let users give a github link to a plugin and the app would get the panel so its usable, it should be managed by a sub page in configuration

### Tech specs

We could provide a template in this repo with a make script like make create-plugin <name> <path-to-plugin> that would copy it and change the name (in readme and others)
The template would contain a plugin.tsx with a boilerplate for a panel along with its editing modal, a templated readme 
The user can then edit a plugin.tsx to add whatever they want and just push to github
In the app, when you then add plugin from github it will build the react component and dynamically add to the frontend, the backend can already handle custom config from json, we would just need to handle conflicts from same name panel-type 

## Export dashboard as sharable file (maybe json)

## More broker infos
MQTT explorer shows those infos for the current broker (probably fropm $SYS), i want to show the same somewhere (maybe config page)
    Broker
    mosquitto version 2.1.2
    Sent
    Received
    1k
    38
    Clients
    Subscriptions
    2
    3
    Sent 5m
    Received last 5min
    54.7
    3.33
    Memory
    Memory (max)
    847k
    853k

## Handle QOS things mqtt and retains ..

## Handle tls connections with certs