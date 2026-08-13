import Link from "next/link";
import { getChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getChatGPTUser();
  return <main className="login-page">
    <section className="login-visual">
      <div className="login-brand"><img src="/insar-satellite-v2.png" alt="InSAR 卫星监测" /><span><b>澜迹</b><small>LANJIFYW · INSAR PLATFORM</small></span></div>
      <div className="login-copy"><span>TIME-SERIES INSAR · WEBGIS</span><h1>让城市形变数据<br />更容易被看见</h1><p>导入监测点、探索空间形变模式、查看单点时间序列，并生成可用于科研汇报与项目展示的交互式成果。</p></div>
      <div className="login-orbit"><i /><i /><i /></div>
    </section>
    <section className="login-form-wrap"><div className="login-form">
      <span className="eyebrow">ACCOUNT ACCESS</span><h2>{user ? "欢迎回来" : "登录工作台"}</h2><p>{user ? `当前账户：${user.displayName}` : "登录后，每个账户拥有独立的数据集与分析空间。"}</p>
      {user ? <><Link className="login-submit" href="/">进入我的工作台 →</Link><a className="login-secondary" href="/signout-with-chatgpt?return_to=/login">退出当前账户</a></> : <><label>账户<input value="通过安全身份服务识别" readOnly /></label><label>密码<input type="password" value="••••••••••••" readOnly /></label><a className="login-submit" href="/signin-with-chatgpt?return_to=/">安全登录 →</a><small className="login-security">账号和密码由安全身份服务校验，本站不接触或保存明文密码。</small></>}
      <div className="login-features"><span><i />账户数据隔离</span><span><i />大文件分片上传</span><span><i />地图按需加载</span></div>
    </div></section>
  </main>;
}
