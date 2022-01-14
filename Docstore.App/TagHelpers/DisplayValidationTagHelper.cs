using Docstore.App.Common.Extensions;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.AspNetCore.Mvc.ViewFeatures;
using Microsoft.AspNetCore.Razor.TagHelpers;

namespace Docstore.App.TagHelpers
{
    [HtmlTargetElement(Attributes = "asp-display-validation-for")]
    public class DisplayValidationTagHelper : TagHelper
    {
        public ModelExpression? AspDisplayValidationFor { get; set; }

        [ViewContext, HtmlAttributeNotBound]
        public ViewContext? ViewContext { get; set; }

        public override void Process(TagHelperContext context, TagHelperOutput output)
        {
            if (AspDisplayValidationFor == null || ViewContext == null)
                return;

            var name = AspDisplayValidationFor.Name;

            if (!ViewContext.ViewData.ModelState.HasError(name))
                output.Content.Clear();
        }
    }
}
