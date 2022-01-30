using Docstore.Application.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ViewFeatures;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using System.Security.Claims;

namespace Docstore.App.Common.Extensions
{
    public static class ControllerExtensions
    {
        public static int GetUserId(this ControllerBase controller)
        {
            if (controller.User == null)
                throw new InvalidOperationException("You're not logged in");

            var identifierClaim = controller.User.FindFirst(ClaimTypes.NameIdentifier);
            return int.Parse(identifierClaim!.Value);
        }

        public static IActionResult AddToast(this IActionResult result, ITempDataDictionary tempData, ToastType type, string message)
        {
            if (tempData[nameof(Toast)] is not List<Toast> toasts)
                toasts = new List<Toast>();

            toasts.Add(new Toast(type, message));
            tempData[nameof(Toast)] = JsonConvert.SerializeObject(toasts, Formatting.None, new JsonSerializerSettings { ContractResolver = new CamelCasePropertyNamesContractResolver() });

            return result;
        }
    }
}
