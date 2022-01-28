using Docstore.App.Common.Extensions;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace Docstore.App.Common.Extendeds
{
    public class ExtendedControllerBase: ControllerBase
    {
        private int? _userId;
        public int UserId
            => _userId ??= this.GetUserId();
    }
}
