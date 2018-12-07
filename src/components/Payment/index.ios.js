import React from "react";
import PropTypes from "prop-types";
import queryString from "query-string";
import { WebView, Linking } from "react-native";
import resolveAssetSource from "react-native/Libraries/Image/resolveAssetSource";

import ErrorOnParams from "../ErrorOnParams";
import { validateProps } from "../../utils";
import {
  PG,
  CALLBACK_AVAILABLE_PG,
  PAY_METHOD,
  CURRENCY,
  MARKET_URL
} from "../../constants";

const source = require("../../html/payment.html");

class Payment extends React.Component {
  static propTypes = {
    userCode: PropTypes.string.isRequired,
    data: PropTypes.shape({
      pg: PropTypes.oneOf(PG),
      pay_method: PropTypes.oneOf(PAY_METHOD),
      currency: PropTypes.oneOf(CURRENCY),
      notice_url: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.arrayOf(PropTypes.string)
      ]),
      display: PropTypes.shape({
        card_quota: PropTypes.arrayOf(PropTypes.number)
      }),
      merchant_uid: PropTypes.string.isRequired,
      amoung: PropTypes.oneOfType([
        PropTypes.string.isRequired,
        PropTypes.number.isRequired
      ]),
      buyer_tel: PropTypes.string.isRequired,
      app_scheme: PropTypes.string.isRequired,
      escrow: PropTypes.bool,
      name: PropTypes.string,
      tax_free: PropTypes.number,
      buyer_name: PropTypes.string,
      buyer_email: PropTypes.string,
      buyer_addr: PropTypes.string,
      buyer_postcode: PropTypes.string,
      custom_data: PropTypes.object,
      vbank_due: PropTypes.string,
      popup: PropTypes.bool
    }).isRequired,
    callback: PropTypes.func.isRequired,
    loading: PropTypes.shape({
      message: PropTypes.string,
      image: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
    })
  };

  state = {
    marketUrl: "",
    status: "ready"
  };

  getRequestContent() {
    let params = this.props.data;
    const merchant_uid =
      params.merchant_uid || "merchant_" + new Date().getTime();
    let HTML = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>i'mport react native payment module</title>
        <meta http-equiv="content-type" content="text/html; charset=utf-8">
      </head>
      <body>
        <script type="text/javascript" src="http://code.jquery.com/jquery-latest.min.js" ></script>
        <script type="text/javascript" src="https://cdn.iamport.kr/js/iamport.payment-1.1.7.js"></script>
        <script type="text/javascript">
          var IMP = window.IMP;
          IMP.init('${this.props.userCode}');
          IMP.request_pay({
            pg : '${params.pg}',
            pay_method : '${params.pay_method}',
            merchant_uid : '${params.merchant_uid}',
            app_scheme : '${params.app_scheme}',
            name : '${params.name}',
            amount : ${params.amount},
            buyer_email : '${params.buyer_email}',
            buyer_name : '${params.buyer_name}',
            buyer_tel : '${params.buyer_tel}',
          }, function(rsp){
           window.postMessage(JSON.stringify(rsp));
         });
        </script>
      </body>
    </html>
    `;
    return HTML;
  }

  onLoad = () => {
    const { status } = this.state;
    if (status === "ready") {
      // 포스트 메시지를 한번만 보내도록(무한루프 방지)
      const { userCode, data, loading } = this.props;

      const params = JSON.stringify({
        userCode,
        data,
        loading: {
          message: loading.message || "잠시만 기다려주세요...",
          image: this.getCustomLoadingImage()
        }
      });
      this.xdm.postMessage(params);
      this.setState({ status: "sent" });
    }
  };

  getCustomLoadingImage() {
    const { loading } = this.props;
    const { image } = loading;

    if (typeof image === "number") {
      return resolveAssetSource(image).uri;
    }

    if (typeof image === "string") {
      return image;
    }

    return "../img/iamport-logo.png";
  }

  onError = () => {
    const { marketUrl } = this.state;
    console.log("onError:", marketUrl);
    alert("onError:", marketUrl);
    if (marketUrl) {
      Linking.openURL(marketUrl); // 앱 스토어로 이동
    }

    // 앱 설치후, 다시 원래 화면으로 돌아온다
    // 웹뷰 로드가 실패한 경우이므로, post 메시지로 처리할 수 없다
    this.xdm.injectJavaScript(`
      window.stop(); 
      window.history.back();
    `);
  };

  onMessage = e => {
    // PG사가 callback을 지원하는 경우, 결제결과를 받아 callback을 실행한다
    const { callback } = this.props;
    const response = JSON.parse(e.nativeEvent.data);

    if (typeof callback === "function") {
      callback(response);
    }
  };

  getInjectedJavascript() {
    // 웹뷰 onMessage override 방지 코드
    const patchPostMessageFunction = function() {
      var originalPostMessage = window.postMessage;

      var patchedPostMessage = function(message, targetOrigin, transfer) {
        originalPostMessage(message, targetOrigin, transfer);
      };

      patchedPostMessage.toString = function() {
        return String(Object.hasOwnProperty).replace(
          "hasOwnProperty",
          "postMessage"
        );
      };

      window.postMessage = patchedPostMessage;
    };

    return `(${String(patchPostMessageFunction)})();`;
  }

  onNavigationStateChange = e => {
    const { status } = this.state;
    if (status === "sent") {
      const { url, query } = queryString.parseUrl(e.url);
      const { data, callback } = this.props;
      const { pg } = data;

      // 웹뷰를 로드하는데 실패하는 경우를 대비해 (필요한 앱이 설치되지 않은 경우 등)
      // app scheme값을 갖고 있는다
      const splittedScheme = url.split("://");
      const scheme = splittedScheme[0];
      if (scheme !== "http" && scheme !== "https" && scheme !== "about:blank") {
        this.setState({
          marketUrl:
            scheme === "itmss"
              ? `https://${splittedScheme[1]}`
              : MARKET_URL[scheme]
        });
      }

      // callback을 지원하지 않는 PG사의 경우를 대비해
      // url을 기준으로 callback을 강제로 실행시킨다
      if (
        this.isUrlMatchingWithIamportUrl(url) &&
        CALLBACK_AVAILABLE_PG.indexOf(pg) === -1
      ) {
        // in case of not supporting callback
        if (typeof callback === "function") {
          callback(query);
        }

        this.setState({ status: "done" });
      }
    }
  };

  isUrlMatchingWithIamportUrl(url) {
    if (url.includes("https://service.iamport.kr/payments/fail")) return true;
    if (url.includes("https://service.iamport.kr/payments/success"))
      return true;
    return false;
  }

  render() {
    const { userCode, data } = this.props;
    const { validate, message } = validateProps(userCode, data);
    if (validate) {
      return (
        <WebView
          ref={xdm => (this.xdm = xdm)}
          source={{ html: this.getRequestContent() }}
          onLoad={this.onLoad}
          onError={this.onError}
          onMessage={this.onMessage}
          originWhitelist={["*"]} // https://github.com/facebook/react-native/issues/19986
          injectedJavaScript={this.getInjectedJavascript()} // https://github.com/facebook/react-native/issues/10865
          onNavigationStateChange={this.onNavigationStateChange}
        />
      );
    }

    return <ErrorOnParams message={message} />;
  }
}

export default Payment;
