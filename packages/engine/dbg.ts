import { GAME_MACHINE } from "./src/core/fsm/GameFSM.ts";
import { transition } from "./src/core/fsm/StateMachine.ts";
import { getLand } from "./src/masterboard/board.data.ts";
import { CARETAKER_LIMITS, CREATURE_NAMES } from "./src/creatures/names.ts";
import { BATTLE_MAPS } from "./src/battleland/maps.data.ts";
import { scriptedRng } from "./src/core/rng/Rng.ts";
import { EndStrikesCommand } from "./src/core/commands/battle-flow.ts";
const FULL=Object.fromEntries(CREATURE_NAMES.map(n=>[n,CARETAKER_LIMITS[n]]));
let P=0; for(let i=1;i<=600;i++){const l=getLand(i); if(l&&l.terrain==="Plains"){P=i;break;}}
const cube=(lbl)=>BATTLE_MAPS.Plains.hexes.find(h=>h.label===lbl).cube;
let fsm=GAME_MACHINE.initialState;
for(const e of ["TURN_ORDER_DETERMINED","TOWERS_SELECTED","COLORS_SELECTED","SPLITS_COMPLETED","MOVEMENT_COMPLETED","ENGAGEMENT_SELECTED","BATTLE_JOINED","DEFENDER_DEPLOYED","ATTACKER_DEPLOYED","MANEUVERS_COMPLETED"]) fsm=transition(GAME_MACHINE,fsm,e);
const s={gameId:"g",fsm,playerOrder:["A","B"],
 players:{A:{id:"A",name:"A",color:"Black",tower:100,score:0,eliminated:false,markersAvailable:["Black-02"]},B:{id:"B",name:"B",color:"Red",tower:400,score:0,eliminated:false,markersAvailable:["Red-02"]}},
 setup:null,turn:{number:2,activeIndex:0,movementRoll:3,mulliganUsed:false,engagementLand:P},
 legions:{"Black-01":{marker:"Black-01",ownerId:"A",land:P,creatures:["Ogre"],moved:true,splitThisTurn:false,recruitedThisTurn:false,revealed:true},
          "Red-01":{marker:"Red-01",ownerId:"B",land:P,creatures:["Centaur"],moved:false,splitThisTurn:false,recruitedThisTurn:false,revealed:true},
          "Red-09":{marker:"Red-09",ownerId:"B",land:400,creatures:["Titan"],moved:false,splitThisTurn:false,recruitedThisTurn:false,revealed:false}},
 caretaker:{...FULL},
 battle:{land:P,terrain:"Plains",attackerLegion:"Black-01",defenderLegion:"Red-01",attackerPlayerId:"A",defenderPlayerId:"B",attackerSide:"BOTTOM",round:1,activeSide:"attacker",summonUsed:false,firstKillHappened:false,reinforcementUsed:false,summonPending:false,
   combatants:[{id:"atk-0",side:"attacker",creature:"Ogre",hex:cube("C3"),damage:0,movedThisPhase:false,struckThisPhase:false,slain:false},
               {id:"def-0",side:"defender",creature:"Centaur",hex:cube("C4"),damage:0,movedThisPhase:false,struckThisPhase:false,slain:true}]}};
const r=new EndStrikesCommand("A",{}).execute(s,scriptedRng([]));
console.log("path",r.state.fsm.path,"A.score",r.state.players.A.score,"battle",r.state.battle, "Black-01",r.state.legions["Black-01"]);
