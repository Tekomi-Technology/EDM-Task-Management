<#-- Page frame for every sign-in page. Two columns on the web; one column, app-style, for the EDM Field app. -->
<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<#assign isApp = (client?? && client.clientId == "edm-mobile")>
<!DOCTYPE html>
<html lang="${(locale.currentLanguageTag)!'en'}">
<head>
    <meta charset="utf-8">
    <meta name="robots" content="noindex, nofollow">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${msg("loginTitle",(realm.displayName!'EDM Tasks'))}</title>
    <link rel="icon" type="image/png" href="${url.resourcesPath}/img/edm-emblem.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet" />
    <#list properties.styles?split(' ') as style>
        <link href="${url.resourcesPath}/${style}" rel="stylesheet" />
    </#list>
    <script type="module">
        import { startSessionPolling } from "${url.resourcesPath}/js/authChecker.js";
        startSessionPolling("${url.ssoLoginInOtherTabsUrl?no_esc}");
    </script>
</head>
<body class="<#if isApp>edm-app<#else>edm-web</#if>">
<main class="edm-page">
    <#if !isApp>
    <section class="edm-brand" aria-hidden="false">
        <img class="edm-logo" src="${url.resourcesPath}/img/edm-logo.png" alt="Electricidade de Moçambique, E.P." />
        <h2>${msg("edmTitle")}</h2>
        <p>${msg("edmTagline")}</p>
        <ul>
            <li>${msg("edmPoint1")}</li>
            <li>${msg("edmPoint2")}</li>
            <li>${msg("edmPoint3")}</li>
        </ul>
    </section>
    </#if>
    <section class="edm-panel">
        <div class="edm-card">
            <#if isApp>
                <img class="edm-logo" src="${url.resourcesPath}/img/edm-logo.png" alt="Electricidade de Moçambique, E.P." />
                <h1 class="edm-app-name">${msg("edmAppName")}</h1>
                <p class="edm-intro edm-center">${msg("edmAppTagline")}</p>
            <#else>
                <h1 id="kc-page-title"><#nested "header"></h1>
            </#if>

            <#if auth?has_content && auth.showUsername() && !auth.showResetCredentials()>
                <div class="edm-username">
                    <span>${auth.attemptedUsername}</span>
                    <a id="reset-login" href="${url.loginRestartFlowUrl}">${msg("restartLoginTooltip")}</a>
                </div>
            </#if>

            <#if displayMessage && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
                <div class="edm-alert edm-alert-${message.type}" role="alert">${kcSanitize(message.summary)?no_esc}</div>
            </#if>

            <#nested "form">

            <#if displayInfo>
                <div class="edm-info"><#nested "info"></div>
            </#if>

            <#if isApp>
                <div class="edm-offline">${msg("edmOffline")}</div>
            </#if>

            <footer class="edm-footer">
                <#if !isApp><span>${msg("edmFieldHint")}</span></#if>
                <#if realm.internationalizationEnabled && locale.supported?size gt 1>
                    <label class="edm-language">
                        <span>${msg("edmLanguage")}</span>
                        <select aria-label="${msg("edmLanguage")}" onchange="window.location.href = this.value">
                            <#list locale.supported as l>
                                <option value="${l.url}" <#if l.languageTag == locale.currentLanguageTag>selected</#if>>${l.label}</option>
                            </#list>
                        </select>
                    </label>
                </#if>
            </footer>
        </div>
    </section>
</main>
</body>
</html>
</#macro>
