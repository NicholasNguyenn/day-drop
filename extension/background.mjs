// Chrome only lets the panel read a tab after a toolbar click that reaches the extension.
// Opening the panel from onClicked (instead of openPanelOnActionClick) makes every click on
// the icon grant activeTab for that tab, which page analysis and page images depend on.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
chrome.action.onClicked.addListener(tab => { chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error); });
