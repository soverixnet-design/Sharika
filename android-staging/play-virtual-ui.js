/* Google Play Personal Account edition: presentation-only hardening.
 * The Android bridge and the isolated Cloudflare Worker independently reject
 * money movement; hiding a control is never a security boundary.
 * This asset is injected ONLY into the dedicated play-virtual release bundle.
 */
(function () {
  'use strict';
  document.documentElement.classList.add('sharika-play-virtual-only');
  const style=document.createElement('style');
  style.id='sharika-play-virtual-closed-loop-ui';
  style.textContent=[
    '#qi,#qg,#pc,#rcl2,#sharika-recharge-seller-wallet,',
    '[data-m="invite"],#sh-bd-entry,#sh-agency-entry,#sh-host-entry,',
    '#sh-open-host-statement,#sh-rank-reward-box,',
    '#rt button:nth-child(1),#rt button:nth-child(6),',
    '#rt button:nth-child(7){display:none!important}'
  ].join('');
  document.head.appendChild(style);

  // Restrict text changes to first-party navigation and headings. Never
  // alter user names, chat, gift messages, or server-generated notices.
  function renameButtonText(selector, oldLabel, newLabel) {
    for(const button of document.querySelectorAll(selector)) {
      const walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT);
      let node;
      while((node=walker.nextNode())) {
        if(node.nodeValue.trim()===oldLabel)
          node.nodeValue=node.nodeValue.replace(oldLabel,newLabel);
      }
    }
  }
  function update() {
    renameButtonText('#qr small,.top-recharge small','Recharge','Coins');
    renameButtonText('#v-me button[data-m="recharge"]','Recharge','Coins');
    renameButtonText('#v-me button[data-sh-profile-action="wallet"]','Wallet','Coins');
    renameButtonText('#v-me .profile-balance-link','Wallet','Coins');
    const top=document.getElementById('qr');
    if(top&&top.title!=='Get virtual coins')top.title='Get virtual coins';
    const notification=document.querySelector('.sh-notify-head p');
    if(notification&&notification.textContent.includes('recharge'))
      notification.textContent='Gifts · friends · community updates · official notices';
  }
  let scheduled=false;
  function schedule() {
    if(scheduled)return;
    scheduled=true;
    queueMicrotask(()=>{scheduled=false;update();});
  }
  document.addEventListener('DOMContentLoaded',()=>{
    update();
    // The profile/ranking screens are rebuilt when a member navigates.
    // These narrowly scoped observers do not watch room chat traffic.
    for(const selector of ['#v-me','#v-rank','#v-msg']) {
      const host=document.querySelector(selector);
      if(host)new MutationObserver(schedule).observe(host,{childList:true,subtree:true});
    }
  },{once:true});
})();
