using Microsoft.AspNetCore.Mvc;
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
    }
}
