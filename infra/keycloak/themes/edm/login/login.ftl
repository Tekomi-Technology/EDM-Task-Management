<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password'); section>
    <#if section = "header">
        ${msg("loginAccountTitle")}
    <#elseif section = "form">
        <#assign isApp = (client?? && client.clientId == "edm-mobile")>
        <#if !isApp><p class="edm-intro">${msg("edmWebIntro")}</p></#if>
        <form id="kc-form-login" class="edm-form" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post">
            <#if !usernameHidden??>
                <div class="edm-group">
                    <label for="username" class="edm-label">${msg("username")}</label>
                    <input id="username" class="edm-input" name="username" value="${(login.username!'')}" type="text"
                           autofocus autocomplete="username" autocapitalize="none" spellcheck="false"
                           aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>" />
                </div>
            </#if>
            <div class="edm-group">
                <label for="password" class="edm-label">${msg("password")}</label>
                <div class="edm-input-group">
                    <input id="password" class="edm-input" name="password" type="password" autocomplete="current-password"
                           aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>" />
                    <button type="button" class="edm-show-text" aria-controls="password"
                            onclick="var p=document.getElementById('password');var hidden=p.type==='password';p.type=hidden?'text':'password';this.textContent=hidden?'${msg("edmHide")}':'${msg("edmShow")}';">${msg("edmShow")}</button>
                </div>
                <#if messagesPerField.existsError('username','password')>
                    <span id="input-error" class="edm-field-error" aria-live="polite">
                        ${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}
                    </span>
                </#if>
            </div>
            <#if !isApp>
            <div class="edm-options">
                <#if realm.rememberMe && !usernameHidden??>
                    <label class="edm-check">
                        <input id="rememberMe" name="rememberMe" type="checkbox" <#if login.rememberMe??>checked</#if>> ${msg("rememberMe")}
                    </label>
                </#if>
                <#if realm.resetPasswordAllowed>
                    <a href="${url.loginResetCredentialsUrl}">${msg("doForgotPassword")}</a>
                <#else>
                    <span class="edm-forgot">${msg("edmForgotWeb")}</span>
                </#if>
            </div>
            </#if>
            <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>
            <input class="edm-btn edm-btn-primary edm-btn-block" name="login" id="kc-login" type="submit" value="${msg("doLogIn")}"/>
            <#if isApp>
                <p class="edm-forgot edm-center">${msg("edmForgotApp")}</p>
            </#if>
        </form>
    </#if>
</@layout.registrationLayout>
