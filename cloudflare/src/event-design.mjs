// Five reviewed, fixed-design event templates. Admin chooses an ID, not
// arbitrary HTML/CSS. All styles are local, with no user-uploaded scripts.
export const ROYAL_EVENT_TEMPLATES=Object.freeze({
 royal_gold:Object.freeze({title:'Royal Gold',accent:'gold',icon:'♛'}),
 diamond_luxury:Object.freeze({title:'Diamond Luxury',accent:'diamond',icon:'◆'}),
 game_tournament:Object.freeze({title:'Royal Game Tournament',accent:'battle',icon:'⚔'}),
 cp_love:Object.freeze({title:'CP Love Festival',accent:'romance',icon:'♥'}),
 festival_special:Object.freeze({title:'Festival Special',accent:'festival',icon:'✦'})
});
export const EVENT_SCORING_MODES=Object.freeze({
 gift_points:Object.freeze({title:'Selected settled gift points',unit:'points'}),
 game_wins:Object.freeze({title:'Verified game prize coins',unit:'coins'}),
 cp_gifts:Object.freeze({title:'Verified CP couple gifts',unit:'coins'})
});
export function safeEventTemplate(value){
 return Object.hasOwn(ROYAL_EVENT_TEMPLATES,String(value))?String(value):'royal_gold';
}
export function safeEventScoring(value){
 return Object.hasOwn(EVENT_SCORING_MODES,String(value))?String(value):'gift_points';
}
export function validEventDesignFields(body){
 return (body.template_id===undefined||
    typeof body.template_id==='string'&&Object.hasOwn(ROYAL_EVENT_TEMPLATES,body.template_id))&&
   (body.scoring_mode===undefined||
    typeof body.scoring_mode==='string'&&Object.hasOwn(EVENT_SCORING_MODES,body.scoring_mode));
}
