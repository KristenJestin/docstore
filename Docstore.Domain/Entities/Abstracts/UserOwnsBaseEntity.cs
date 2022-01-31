namespace Docstore.Domain.Entities.Abstracts
{
    public abstract class UserOwnsBaseEntity : BaseEntity
    {
        public int UserId { get; set; }

        #region relations
        public ApplicationIdentityUser? User { get; set; }
        #endregion
    }
}
