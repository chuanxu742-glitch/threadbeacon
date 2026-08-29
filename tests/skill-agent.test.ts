import { describe, expect, it } from 'vitest';
import { executeSkillAgent, parseSkillDecision, skillActionRisk, type SkillAgentRun } from '../src/skill-agent.js';
import type { ILlmClient, LlmResult } from '../src/llm/types.js';

const base:SkillAgentRun={id:'r1',task_text:'observe',domain:'example.com',capability:'observe',skill_name:'observe',scope:'read only',skill_md:'# Observe',elements_json:JSON.stringify({terminal_conditions:['captured'],red_lines:['pay now']}),context_json:'{}',agent_state_json:'{}',allowlist_json:'["example.com"]',max_steps:5};
function llm(outputs:string[]):ILlmClient{return{format:'openai',model:'fake',async complete():Promise<LlmResult>{const text=outputs.shift()??'{"type":"done","terminalConditionsHit":["captured"]}';return{text,model:'fake',usage:{inputTokens:1,outputTokens:1},stopReason:'stop',refused:false};}};}

describe('skill agent runtime',()=>{
  it('parses fenced decisions and blocks red lines',()=>{expect(parseSkillDecision('```json\n{"type":"snapshot"}\n```').type).toBe('snapshot');expect(skillActionRisk({type:'click',note:'Pay now'},{role:'button',name:'Pay now'},['pay now']).redLine).toBe('pay now');});
  it('pauses ambiguous writes for human confirmation',async()=>{const executor=async(command:any)=>({capability:'cdp' as const,status:'completed' as const,targetId:'tab-1',tabs:[{id:'tab-1',title:'',url:'https://example.com/',type:'page'}]});const result=await executeSkillAgent(base,llm(['{"type":"click","input":{"selector":"button"},"rationale":"open"}']),'http://cdp',executor as any);expect(result.status).toBe('paused');expect(result.action?.['type']).toBe('click');});
  it('finishes only with declared terminal evidence',async()=>{const executor=async(command:any)=>({capability:'cdp' as const,status:'completed' as const,targetId:'tab-1',tabs:[{id:'tab-1',title:'',url:'https://example.com/',type:'page'}]});const result=await executeSkillAgent(base,llm(['{"type":"done","terminalConditionsHit":["captured"]}']),'http://cdp',executor as any);expect(result.status).toBe('completed');expect(result.outcome?.['loopOutcome']).toBe('done_success');});
});
