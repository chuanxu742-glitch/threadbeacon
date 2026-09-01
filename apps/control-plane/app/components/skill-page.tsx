import { AppNav } from './app-nav.js';
import { SkillClient } from './skill-client.js';

export function SkillPage({ user, onSignOut }: { user: { displayName: string; email: string }; onSignOut: () => void }) {
  return <div className="skill-page-shell">
    <AppNav active="skills" user={user} onSignOut={onSignOut} contextLabel="自动化能力" contextItems={[
      {id:'skills',label:'我的 Skills',icon:'◈',active:true,href:'/skills'},
      {id:'studio',label:'项目工作流',icon:'◇',href:'/studio'},
    ]}/>
    <SkillClient user={user}/>
  </div>;
}
