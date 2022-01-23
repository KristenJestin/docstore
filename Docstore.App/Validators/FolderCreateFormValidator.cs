using Docstore.App.Models.Forms;
using FluentValidation;

namespace Docstore.App.Validators
{
    public class FolderCreateFormValidator : AbstractValidator<FolderCreateForm>
    {
        public FolderCreateFormValidator()
        {
            RuleFor(x => x.Name)
                .NotEmpty()
                .MaximumLength(255);
        }
    }
}
