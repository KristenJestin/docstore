using Docstore.App.Common.Extensions;
using Microsoft.AspNetCore.Mvc;

namespace Docstore.App.Common.Extendeds
{
    public class ExtendedController : Controller
    {
        private int? _userId;
        public int UserId
            => _userId ??= this.GetUserId();


        // To work with `nameof(CONTROLLER_NAME)`
        public override RedirectToActionResult RedirectToAction(string? actionName, string? controllerName)
            => base.RedirectToAction(actionName, RemoveController(controllerName));
        public override RedirectToActionResult RedirectToAction(string? actionName, string? controllerName, object? routeValues)
            => base.RedirectToAction(actionName, RemoveController(controllerName), routeValues);
        public override RedirectToActionResult RedirectToAction(string? actionName, string? controllerName, object? routeValues, string? fragment)
            => base.RedirectToAction(actionName, RemoveController(controllerName), routeValues, fragment);
        public override RedirectToActionResult RedirectToAction(string? actionName, string? controllerName, string? fragment)
            => base.RedirectToAction(actionName, RemoveController(controllerName), fragment);


        #region privates
        /// <summary>
        /// Removes the word "Controller" from the string.
        /// </summary>
        private static string? RemoveController(string? value)
            => value?.Replace("Controller", "");
        #endregion
    }
}
